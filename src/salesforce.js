// Salesforce connector for referral-relationship sync (reciprocity tracking).
//
// Salesforce is the system of record for INBOUND referrals (who sends us
// business). This connector lets the app (a) pull inbound referral counts per
// partner so the Partners page can show "we sent X ↔ they sent us Y", and
// (b) push our OUTBOUND referrals back so BD can see both sides in Salesforce.
//
// Auth uses the OAuth 2.0 Client-Credentials flow (a Connected App). Set on your
// host (never commit):
//   SF_INSTANCE_URL   e.g. https://yourorg.my.salesforce.com
//   SF_CLIENT_ID      Connected App consumer key
//   SF_CLIENT_SECRET  Connected App consumer secret
// Optional: SF_API_VERSION (default v60.0), SF_INBOUND_SOQL / SF_OUTBOUND_OBJECT
//   to match your org's object/field names.
//
// Until credentials exist this stays inert; the app's own referral tracking
// works fully without it.

import { getState } from './db.js';

let _token = null, _tokenExp = 0;

// Config resolves from in-app settings first, then env vars.
function scfg(key, envName) { const v = getState('sf_' + key); return (v != null && v !== '') ? v : (process.env[envName] || ''); }
export function sfConfigured() {
  return Boolean(scfg('instance_url', 'SF_INSTANCE_URL') && scfg('client_id', 'SF_CLIENT_ID') && scfg('client_secret', 'SF_CLIENT_SECRET'));
}
export function sfStatus() {
  return { configured: sfConfigured(), instanceUrl: scfg('instance_url', 'SF_INSTANCE_URL'), hasSecret: !!scfg('client_secret', 'SF_CLIENT_SECRET'), apiVersion: scfg('api_version', 'SF_API_VERSION') || 'v60.0' };
}

function sfBase() {
  return scfg('instance_url', 'SF_INSTANCE_URL').replace(/\/+$/, '');
}
function sfVersion() {
  return scfg('api_version', 'SF_API_VERSION') || 'v60.0';
}

// OAuth 2.0 client-credentials token (cached until ~2 min before expiry).
async function sfToken() {
  if (!sfConfigured()) throw new Error('Salesforce not configured. Set SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET.');
  if (_token && Date.now() < _tokenExp) return _token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: scfg('client_id', 'SF_CLIENT_ID'),
    client_secret: scfg('client_secret', 'SF_CLIENT_SECRET'),
  });
  const r = await fetch(sfBase() + '/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`Salesforce auth failed (${r.status}): ${data.error_description || data.error || 'no token'}`);
  _token = data.access_token;
  _tokenExp = Date.now() + 25 * 60 * 1000; // refresh well before the typical expiry
  return _token;
}

async function sfQuery(soql) {
  const token = await sfToken();
  const url = `${sfBase()}/services/data/${sfVersion()}/query?q=${encodeURIComponent(soql)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Salesforce query ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Like sfQuery but follows pagination (nextRecordsUrl) and returns all records.
async function sfQueryAll(soql, cap = 5000) {
  const token = await sfToken();
  let url = `${sfBase()}/services/data/${sfVersion()}/query?q=${encodeURIComponent(soql)}`;
  const out = [];
  while (url && out.length < cap) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Salesforce query ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
    out.push(...(data.records || []));
    url = data.done ? null : (data.nextRecordsUrl ? sfBase() + data.nextRecordsUrl : null);
  }
  return out;
}

// Connectivity check used by Settings before any sync.
export async function sfTest() {
  const data = await sfQuery('SELECT Id FROM Account LIMIT 1');
  return { ok: true, sampleCount: data.totalSize ?? null };
}

// --- Schema discovery -------------------------------------------------------
// Every org models referrals differently, so before we can write the right
// sync query we ask the org what it actually has. These helpers power the
// "Discover" button in Settings → Salesforce.

async function sfGet(path) {
  const token = await sfToken();
  const r = await fetch(`${sfBase()}/services/data/${sfVersion()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Salesforce ${path} ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// List the objects most likely to hold referral / patient data: all custom
// objects (__c) plus the standard sales objects. Returns name + label + counts
// so we (and the user) can spot which one is the referral record.
export async function sfDiscover() {
  const data = await sfGet('/sobjects/');
  const wanted = new Set(['Lead', 'Opportunity', 'Account', 'Contact', 'Case']);
  const objs = (data.sobjects || [])
    .filter(o => o.queryable && (o.custom || wanted.has(o.name)))
    .map(o => ({ name: o.name, label: o.label, custom: !!o.custom }))
    .sort((a, b) => (a.custom === b.custom ? a.name.localeCompare(b.name) : (a.custom ? -1 : 1)));
  return { count: objs.length, objects: objs };
}

// Describe one object's fields (name, label, type, and the target object for
// lookups/master-detail) plus a couple of sample rows so we can map fields to
// referral source, status/outcome, and the patient/Kipu link.
export async function sfDescribe(objectName) {
  const name = String(objectName || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!name) throw new Error('object name required');
  const d = await sfGet(`/sobjects/${name}/describe/`);
  const fields = (d.fields || []).map(f => ({
    name: f.name, label: f.label, type: f.type,
    refTo: (f.referenceTo && f.referenceTo.length) ? f.referenceTo : undefined,
    relationship: f.relationshipName || undefined,
  }));
  let sample = [];
  try {
    const picks = fields.filter(f => ['id','string','reference','picklist','datetime','date','phone','email'].includes(f.type)).slice(0, 12).map(f => f.name);
    if (picks.length) {
      const q = await sfQuery(`SELECT ${picks.join(', ')} FROM ${name} ORDER BY CreatedDate DESC LIMIT 3`);
      sample = (q.records || []).map(r => { const o = {}; for (const k of picks) o[k] = r[k]; return o; });
    }
  } catch { /* sampling is best-effort */ }
  return { object: name, fieldCount: fields.length, fields, sample };
}

// Auto-map: scan the likely referral/patient objects and score each on whether
// it carries (a) a referral source, (b) a patient name, (c) an MRN/Kipu id,
// (d) a status/stage. Returns a ranked guess so we don't have to hand-pick.
const MAP_PATTERNS = {
  referral: /referr|source|sender|partner|marketer|rep\b|bd\b/i,
  patient:  /first.?name|last.?name|patient|client|full.?name|^name$/i,
  mrn:      /\bmrn\b|chart|record.?num|kipu|patient.?id|medical.?record/i,
  status:   /status|stage|outcome|disposition|admit|schedul/i,
  date:     /admit|schedul|created|intake.?date|adm.?date/i,
  insurance:/insur|payer|payor|plan/i,
};
export async function sfAutomap() {
  const all = await sfDiscover();
  const skip = /^rh2__|__mdt$|__hd$/i;
  const wanted = new Set(['Lead', 'Opportunity', 'Contact']);
  const candidates = all.objects
    .filter(o => (o.custom && !skip.test(o.name)) || wanted.has(o.name))
    .map(o => o.name);
  const results = [];
  for (const name of candidates) {
    let d; try { d = await sfDescribe(name); } catch (e) { results.push({ object: name, error: e.message }); continue; }
    const hits = {};
    for (const [k, re] of Object.entries(MAP_PATTERNS)) {
      hits[k] = d.fields.filter(f => re.test(f.name) || re.test(f.label || '')).map(f => f.name);
    }
    // Score: referral + patient are the must-haves; everything else is bonus.
    const score = (hits.referral.length ? 3 : 0) + (hits.patient.length ? 3 : 0)
      + (hits.mrn.length ? 2 : 0) + (hits.status.length ? 1 : 0)
      + (hits.date.length ? 1 : 0) + (hits.insurance.length ? 1 : 0);
    results.push({ object: name, fieldCount: d.fieldCount, score, hits, hasSample: !!(d.sample && d.sample.length) });
  }
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { scanned: candidates.length, best: results[0]?.object || null, results };
}

// --- Referral-source sync ---------------------------------------------------
// Salesforce Leads are the inbound referral record (who sent us each patient).
// Kipu is the source of truth for who actually *admitted*. So we pull Leads,
// then match them to the clients we already pulled from Kipu (by Patient_ID /
// MRN, else name + DOB). Only matched people came through detox, which is
// exactly the "scheduled or admitted only" rule. We fill clients.referral_source
// (and backfill DOB/insurance when missing) so the Command Center can show
// referral source -> retention. Partner-level reciprocity is also kept in
// inbound_referrals for the Partners page.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// Best referral-source label for a Lead: the referring org/person wins, then
// the marketing channel, then the web "how did you hear" answer.
function leadSource(rec) {
  return (rec.Referring_Organization__r && rec.Referring_Organization__r.Name)
    || (rec.Referring_Contact__r && rec.Referring_Contact__r.Name)
    || rec.LeadSource
    || rec.Web_Form_How_did_you_hear_about_us__c
    || null;
}

export async function sfSyncInbound(db) {
  const soql = process.env.SF_INBOUND_SOQL || `
    SELECT Id, FirstName, LastName, Preferred_Name__c, DOB__c, Patient_ID__c,
           LeadSource, Status, IsConverted, ConvertedDate, Date_Looking_to_Admit__c, CreatedDate,
           Insurance_Company__c, Plan_Type__c, Member_ID__c,
           Referring_Organization__c, Referring_Organization__r.Name,
           Referring_Contact__c, Referring_Contact__r.Name,
           Web_Form_How_did_you_hear_about_us__c
    FROM Lead WHERE CreatedDate = LAST_N_DAYS:365 AND (IsConverted = true OR Patient_ID__c != null)`;
  const records = await sfQueryAll(soql);

  // Load the clients we know about (from Kipu) for matching.
  const clients = db.prepare(`SELECT id, name, dob, mrn, referral_source, insurance FROM clients`).all();
  const byMrn = new Map();
  const byName = new Map(); // normalized "first last" -> [clients]
  for (const c of clients) {
    if (c.mrn) byMrn.set(String(c.mrn).trim(), c);
    const n = norm(c.name);
    if (n) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(c); }
  }
  const matchClient = (rec) => {
    const pid = (rec.Patient_ID__c || '').trim();
    if (pid && byMrn.has(pid)) return byMrn.get(pid);
    const full = norm(`${rec.FirstName || ''} ${rec.LastName || ''}`);
    let cands = byName.get(full) || [];
    if (!cands.length) {
      // looser: client name contains both first and last
      const f = norm(rec.FirstName), l = norm(rec.LastName);
      if (f && l) cands = clients.filter(c => { const cn = norm(c.name); return cn.includes(f) && cn.includes(l); });
    }
    const dob = (rec.DOB__c || '').slice(0, 10);
    if (dob && cands.length > 1) { const exact = cands.filter(c => (c.dob || '').slice(0, 10) === dob); if (exact.length) cands = exact; }
    // If DOB is present on both and disagrees, it's a different person.
    if (dob) cands = cands.filter(c => !c.dob || (c.dob || '').slice(0, 10) === dob);
    return cands[0] || null;
  };

  const updClient = db.prepare(`UPDATE clients SET referral_source = COALESCE(NULLIF(referral_source,''), ?),
      dob = COALESCE(NULLIF(dob,''), ?), insurance = COALESCE(NULLIF(insurance,''), ?) WHERE id = ?`);
  const setSource = db.prepare(`UPDATE clients SET referral_source = ? WHERE id = ?`);

  // Partner reciprocity bookkeeping.
  const findFac = db.prepare(`SELECT id FROM facilities WHERE name = ? COLLATE NOCASE`);
  const insFac = db.prepare(`INSERT INTO facilities (name, salesforce_id) VALUES (?, NULL)`);
  const exists = db.prepare(`SELECT id FROM inbound_referrals WHERE salesforce_id = ?`);
  const insRef = db.prepare(`INSERT INTO inbound_referrals (ref_date, facility_id, facility_name, outcome, salesforce_id) VALUES (?,?,?,?,?)`);

  let leads = records.length, matched = 0, updated = 0, partnerRefs = 0;
  db.exec('BEGIN');
  try {
    for (const rec of records) {
      const src = leadSource(rec);
      // 1) Enrich the matched Kipu client with referral source + demographics.
      const c = matchClient(rec);
      if (c) {
        matched++;
        const dob = (rec.DOB__c || '').slice(0, 10) || null;
        updClient.run(src || null, dob, rec.Insurance_Company__c || null, c.id);
        // If the client's source is still blank/Unspecified, force the SF value.
        if (src && (!c.referral_source || /^unspecified$/i.test(c.referral_source))) setSource.run(src, c.id);
        updated++;
      }
      // 2) Track partner-level reciprocity for org referrals.
      const orgName = rec.Referring_Organization__r && rec.Referring_Organization__r.Name;
      if (orgName && rec.Id && !exists.get(rec.Id)) {
        const fac = findFac.get(orgName);
        const facId = fac ? fac.id : insFac.run(orgName).lastInsertRowid;
        const refDate = (rec.ConvertedDate || rec.CreatedDate || '').slice(0, 10) || null;
        const outcome = rec.IsConverted ? 'admitted' : ((rec.Status || '').toLowerCase() || 'pending');
        insRef.run(refDate, facId, orgName, outcome, rec.Id);
        partnerRefs++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { leads, matched, updated, partnerRefs };
}

// --- Scheduled arrivals (front-desk board) ----------------------------------
// Pull Leads with a scheduled admit date in a window around today and upsert
// into expected_arrivals. Preserves front-desk actions (arrived/no-show) and
// the Kipu-confirmed flag on rows already worked.
export async function sfSyncArrivals(db) {
  const soql = process.env.SF_ARRIVALS_SOQL || `
    SELECT Id, FirstName, LastName, Preferred_Name__c, DOB__c, Phone, MobilePhone,
           Date_Looking_to_Admit__c, LeadSource, Status, Patient_ID__c,
           Insurance_Company__c, Plan_Type__c,
           Referring_Organization__r.Name, Referring_Contact__r.Name,
           Web_Form_How_did_you_hear_about_us__c
    FROM Lead
    WHERE Date_Looking_to_Admit__c >= LAST_N_DAYS:3 AND Date_Looking_to_Admit__c <= NEXT_N_DAYS:21
    ORDER BY Date_Looking_to_Admit__c ASC`;
  const records = await sfQueryAll(soql);

  const find = db.prepare(`SELECT id, status FROM expected_arrivals WHERE sf_lead_id = ?`);
  const ins = db.prepare(`INSERT INTO expected_arrivals
    (sf_lead_id, first_name, last_name, preferred_name, dob, phone, scheduled_date, program, referral_source, insurance)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  // Only refresh descriptive fields on rows still 'expected' — never clobber a
  // front-desk arrived/no-show decision.
  const upd = db.prepare(`UPDATE expected_arrivals SET first_name=?, last_name=?, preferred_name=?, dob=?, phone=?,
    scheduled_date=?, program=?, referral_source=?, insurance=?, updated_at=datetime('now')
    WHERE sf_lead_id=? AND status='expected'`);

  let pulled = records.length, created = 0, updated = 0;
  db.exec('BEGIN');
  try {
    for (const r of records) {
      const sched = (r.Date_Looking_to_Admit__c || '').slice(0, 10) || null;
      if (!sched) continue;
      const vals = [
        r.FirstName || null, r.LastName || null, r.Preferred_Name__c || null,
        (r.DOB__c || '').slice(0, 10) || null, r.Phone || r.MobilePhone || null,
        sched, null /*program*/, leadSource(r) || null, r.Insurance_Company__c || null,
      ];
      const existing = find.get(r.Id);
      if (existing) { upd.run(...vals, r.Id); updated++; }
      else { ins.run(r.Id, ...vals); created++; }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { pulled, created, updated };
}

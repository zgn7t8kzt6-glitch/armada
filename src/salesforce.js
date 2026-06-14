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

// Pull inbound referrals grouped by source account and upsert into
// inbound_referrals. The SOQL is overridable per-org via SF_INBOUND_SOQL; it
// must return columns aliased as: source_name, ref_date, outcome, sf_id.
export async function sfSyncInbound(db) {
  const soql = process.env.SF_INBOUND_SOQL ||
    `SELECT Id sf_id, ReferralSource__r.Name source_name, CreatedDate ref_date, Status__c outcome
     FROM Referral__c WHERE CreatedDate = LAST_N_DAYS:180`;
  const data = await sfQuery(soql);
  const records = data.records || [];
  const findFac = db.prepare(`SELECT id FROM facilities WHERE name = ? COLLATE NOCASE`);
  const insFac = db.prepare(`INSERT INTO facilities (name, salesforce_id) VALUES (?, NULL)`);
  const exists = db.prepare(`SELECT id FROM inbound_referrals WHERE salesforce_id = ?`);
  const ins = db.prepare(`INSERT INTO inbound_referrals (ref_date, facility_id, facility_name, outcome, salesforce_id) VALUES (?,?,?,?,?)`);
  let created = 0, skipped = 0;
  for (const rec of records) {
    const name = rec.source_name || 'Unknown source';
    if (rec.sf_id && exists.get(rec.sf_id)) { skipped++; continue; }
    let fac = findFac.get(name);
    const facId = fac ? fac.id : insFac.run(name).lastInsertRowid;
    ins.run((rec.ref_date || '').slice(0, 10) || null, facId, name, (rec.outcome || '').toLowerCase() || 'pending', rec.sf_id || null);
    created++;
  }
  return { total: records.length, created, skipped };
}

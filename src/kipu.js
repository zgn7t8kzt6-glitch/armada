// Kipu EMR connector. Kipu signs requests with the APIAuth (HMAC-SHA1) scheme.
// Credentials come from the environment (set them on your HIPAA host — never commit):
//   KIPU_ACCESS_ID, KIPU_SECRET_KEY, KIPU_APP_ID (a.k.a. recipient/location id),
//   KIPU_BASE_URL (default https://api.kipuapi.com)
// NOTE: the exact canonical string + roster endpoint can vary by Kipu API
// version; this implements the documented v3 pattern and is verified on first
// connect via /api/kipu/test before any sync.
import crypto from 'node:crypto';
import { db, parseLoc, rollupDailyMetrics, appToday, addDays } from './db.js';

export function kipuConfigured() {
  return Boolean(process.env.KIPU_ACCESS_ID && process.env.KIPU_SECRET_KEY && process.env.KIPU_APP_ID);
}

// Run an async fn over items with bounded concurrency (keeps order).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = undefined; } }
  }));
  return out;
}

async function kipuGet(path) {
  if (!kipuConfigured()) throw new Error('Kipu not configured. Set KIPU_ACCESS_ID, KIPU_SECRET_KEY, and KIPU_APP_ID.');
  const base = process.env.KIPU_BASE_URL || 'https://api.kipuapi.com';
  const app = process.env.KIPU_APP_ID;
  const uri = path + (path.includes('?') ? '&' : '?') + 'app_id=' + encodeURIComponent(app);
  const contentType = 'application/vnd.kipusystems+json; version=3';
  const date = new Date().toUTCString();
  const contentMd5 = crypto.createHash('md5').update('').digest('base64');
  const canonical = [contentType, contentMd5, uri, date].join(',');
  const sig = crypto.createHmac('sha1', process.env.KIPU_SECRET_KEY).update(canonical).digest('base64');
  const r = await fetch(base + uri, {
    headers: {
      Accept: contentType,
      'Content-Type': contentType,
      'Content-MD5': contentMd5,
      Date: date,
      Authorization: `APIAuth ${process.env.KIPU_ACCESS_ID}:${sig}`,
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Kipu ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { return text; }
}

// Fetch ONE evaluation's detail, robust to addressing. A patient (master) can
// have several casefiles (re-admissions); a note may belong to a different
// casefile than the current stay, so try master-scoped addressing first (works
// across stays), then casefile-scoped. Throws the last error if all fail.
async function fetchEvalDetail(casefileId, evalId) {
  const s = String(casefileId), master = s.split(':')[0], uuid = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  const phi = process.env.KIPU_PHI_LEVEL || 'high';
  const e = encodeURIComponent;
  evalId = e(String(evalId));   // never let an id inject extra path/query segments
  const cands = [
    `/api/patients/${master}/patient_evaluations/${evalId}?phi_level=${phi}&patient_master_id=${e(uuid)}`,
    `/api/patient_evaluations/${evalId}?patient_master_id=${e(uuid)}&phi_level=${phi}`,
    `/api/patient_evaluations/${evalId}?patient_id=${s}`,
    `/api/patient_evaluations/${evalId}?patient_id=${master}&phi_level=${phi}`,
    `/api/patient_evaluations/${evalId}`,
  ];
  let lastErr = 'detail fetch failed';
  for (const url of cands) {
    try { const d = await kipuGet(url); const ev = d?.patient_evaluation || d?.evaluation || d; if (ev && typeof ev === 'object') return ev; }
    catch (err) { lastErr = String(err.message || err).slice(0, 160); }
  }
  throw new Error(lastErr);
}

// The list of a patient's evaluations. By default scoped to the CURRENT stay
// (the casefile) via the master sub-resource; pass { all:true } for the whole
// cross-admission history. Walks every page until exhausted.
async function evalListRaw(casefileId, { all = false } = {}) {
  const s = String(casefileId), master = s.split(':')[0], uuid = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  const phi = process.env.KIPU_PHI_LEVEL || 'high', e = encodeURIComponent;
  const tmpl = process.env.KIPU_NOTES_PATH || '/api/patient_evaluations?patient_id={id}';
  const bases = all
    ? [tmpl.replace('{id}', s)]
    : [`/api/patients/${master}/patient_evaluations?phi_level=${phi}&patient_master_id=${e(uuid)}`, tmpl.replace('{id}', s)];
  let list = null, baseUsed = null;
  for (const base of bases) {
    try { const d = await kipuGet(base); const arr = d?.patient_evaluations || d?.evaluations || (Array.isArray(d) ? d : null); if (Array.isArray(arr)) { list = arr; baseUsed = base; break; } }
    catch { /* try next base */ }
  }
  if (!list) return [];
  const sep = baseUsed.includes('?') ? '&' : '?';
  const seenIds = new Set(list.map((x) => x.id ?? x.evaluation_id));
  for (let pg = 2; pg <= 80; pg++) {
    let chunk = [];
    try { const d = await kipuGet(baseUsed + sep + 'page=' + pg); chunk = d?.patient_evaluations || d?.evaluations || (Array.isArray(d) ? d : []); }
    catch { break; }
    if (!chunk.length) break;
    const fresh = chunk.filter((x) => { const k = x.id ?? x.evaluation_id; if (k == null || seenIds.has(k)) return false; seenIds.add(k); return true; });
    if (!fresh.length) break;
    list = list.concat(fresh);
    if (list.length > 8000) break;
  }
  // Anti-contamination: when rows carry a casefile, keep this patient's only.
  list = list.filter((x) => { const cf = x.patient_casefile_id ?? x.casefile_id ?? x.patient_id; if (cf == null || cf === '') return true; const v = String(cf); return v === s || v.split(':')[0] === master; });
  return list;
}

// Quick connectivity check.
export async function kipuTest() {
  const path = process.env.KIPU_TEST_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const n = Array.isArray(data?.patients) ? data.patients.length : (Array.isArray(data) ? data.length : null);
  return { ok: true, sampleCount: n };
}

// Deep-search an object for the first value whose KEY matches a pattern (the
// level of care / referral source can live nested in the patient detail).
function deepFind(obj, keyRe, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (keyRe.test(k) && v != null && typeof v !== 'object' && String(v).trim()) return String(v);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const f = deepFind(v, keyRe, depth + 1); if (f) return f; }
  }
  return null;
}
const LOC_KEY_RE = /(level.*of.*care|levelofcare|^loc$|care.?level|^asam|asam.?level|program|treatment.?track|^level$|^track$)/i;
const REF_KEY_RE = /(referr|marketing.?source|lead.?source|source.?of|referral)/i;
// Fetch one patient's full record (the census omits LOC/program/referral).
// Kipu addresses the patient as {patient_master_id}:{casefile_id}: the PATH is
// the numeric master (Integer-parsed) and the casefile UUID rides in the query.
// phi_level is required (else 422); high returns the clinical fields we need.
function kipuDetailPaths(casefileId) {
  const phi = process.env.KIPU_PHI_LEVEL || 'high';
  const s = String(casefileId);
  const master = s.split(':')[0];
  const uuid = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  const e = encodeURIComponent;
  return [
    `/api/patients/${master}?phi_level=${phi}&patient_master_id=${e(uuid)}`,
    `/api/patients/${master}?phi_level=${phi}&casefile_id=${e(uuid)}`,
    `/api/patients/${master}?phi_level=${phi}&patient_master_id=${master}&casefile_id=${e(uuid)}`,
    `/api/patients/${e(uuid)}?phi_level=${phi}&patient_master_id=${master}`,
  ];
}
async function kipuPatientDetail(casefileId) {
  for (const path of kipuDetailPaths(casefileId)) {
    try { const d = await kipuGet(path); const det = d?.patient || (Array.isArray(d?.patients) ? d.patients[0] : null) || d; if (det && typeof det === 'object') return det; }
    catch { /* try next shape */ }
  }
  return null;
}

// Pull the roster and upsert into clients. Idempotent on the Kipu id (falls back
// to name). Non-destructive: only fills blank fields on existing clients so it
// can't clobber staff edits. Maps the analytics fields (admit time, therapist,
// discharge where/why) whenever Kipu charts them — so they're never re-entered.
export async function kipuSyncRoster() {
  let path = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  // Scope the census to one location server-side when KIPU_LOCATION_ID is set.
  const locId = (process.env.KIPU_LOCATION_ID || '').trim();
  if (locId && !/location_id=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  let created = 0, matched = 0;
  const byKipu = db.prepare(`SELECT id, loc, active FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id, loc, active FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, loc, admit, admit_time, therapist, case_manager, referral_source, dob, diagnosis, insurance, phone, pronouns, language, mrn, payment_method, next_loc, anticipated_dc, kipu_id, source, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'kipu', 1)`);
  const admRef = db.prepare(`SELECT referral_source FROM admissions WHERE referral_source IS NOT NULL AND referral_source != '' AND (name = ? OR name = ?) ORDER BY id DESC LIMIT 1`);
  // Flow-event recorder: one row per real transition, so re-running the sync
  // never double-counts. parseLoc → a known ASAM code, or null if unspecified.
  const evt = db.prepare(`INSERT INTO flow_events (client_id, kipu_id, kind, from_loc, to_loc, date, detail) VALUES (?,?,?,?,?,?,?)`);
  const today = appToday();
  const yest = addDays(today, -1);
  const realLoc = (t) => { const c = parseLoc(t); return c === 'Unspecified' ? null : c; };
  const isAma = (s) => /ama|against medical/i.test(String(s || ''));

  // Pull a field from the many shapes Kipu can return.
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const timeOf = (v) => { if (!v) return null; const m = String(v).match(/[T ](\d{2}:\d{2})/); return m ? m[1] : null; };
  const activeKids = [];   // census patients who are currently active (no discharge)
  const newDischarges = [];   // census rows for recently-discharged patients we don't have yet

  // Location scoping. Prefer KIPU_LOCATION_ID (exact); fall back to a
  // KIPU_LOCATION name match. Belt-and-suspenders on top of the API filter.
  const wantLocId = (process.env.KIPU_LOCATION_ID || '').trim();
  const wantLoc = (process.env.KIPU_LOCATION || '').trim().toLowerCase();
  const matchesLoc = (p) => {
    if (wantLocId) {
      const id = pick(p, 'location_id', 'locationId', 'location_id_value', 'location');
      return id != null && String(id) === wantLocId;
    }
    if (!wantLoc) return true;
    const c = pick(p, 'location_name', 'location', 'program', 'level_of_care', 'facility_name', 'facility', 'building', 'unit', 'site');
    if (c && String(c).toLowerCase().includes(wantLoc)) return true;
    for (const v of Object.values(p)) { if (typeof v === 'string' && v.toLowerCase().includes(wantLoc)) return true; }
    return false;
  };

  // Optional recency filter — OFF by default (the census count is authoritative).
  // Set KIPU_ADMIT_DAYS only if you want to drop very old admissions.
  const admitDays = process.env.KIPU_ADMIT_DAYS ? +process.env.KIPU_ADMIT_DAYS : 0;
  const admitCutoff = admitDays ? new Date(Date.now() - admitDays * 864e5).toISOString().slice(0, 10) : null;
  // The census has no level-of-care/program field, so fetch each active
  // patient's detail to find it. On by default; KIPU_PATIENT_DETAIL=false to skip.
  const useDetail = process.env.KIPU_PATIENT_DETAIL !== 'false';
  // Prefetch every matched patient's detail IN PARALLEL — the census lacks the
  // clinical fields, and fetching these one-by-one was the slow part of a sync.
  const detailMap = new Map();
  if (useDetail) {
    const kids = [];
    for (const p of list) {
      if (!matchesLoc(p)) continue;
      const raw = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn');
      if (raw) kids.push(String(raw));
    }
    const uniq = [...new Set(kids)].slice(0, +(process.env.KIPU_DETAIL_MAX || 400));
    const fetched = await mapLimit(uniq, +(process.env.KIPU_CONCURRENCY || 6), async (kid) => [kid, await kipuPatientDetail(kid).catch(() => null)]);
    for (const f of fetched) if (f && f[1]) detailMap.set(f[0], f[1]);
  }

  for (const p of list) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
    if (!name) continue;
    if (!matchesLoc(p)) continue;
    const kid = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn') && String(pick(p, 'casefile_id', 'id', 'patient_id', 'mrn'));
    const admitRaw = pick(p, 'admission_date', 'admit_date', 'admitted_at');
    const admit = admitRaw ? String(admitRaw).slice(0, 10) : null;
    if (admitCutoff && admit && admit < admitCutoff) continue;   // opt-in recency filter
    const admitTime = timeOf(admitRaw);
    let therapist = pick(p, 'primary_therapist', 'therapist', 'counselor');
    let caseMgr = pick(p, 'case_manager', 'casemanager');
    let room = pick(p, 'bed_name', 'room', 'bed', 'bed_name_full');
    // Demographics the census DOES carry — map them straight through.
    const flat = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v != null ? String(v) : null);
    const dob = flat(pick(p, 'dob', 'date_of_birth'));
    const diagnosis = flat(pick(p, 'diagnosis_codes', 'diagnoses', 'diagnosis'));
    const insurance = flat(pick(p, 'insurance_company', 'insurance', 'insurance_name'));
    const phone = flat(pick(p, 'phone', 'phone_number', 'mobile'));
    const pronouns = flat(pick(p, 'pronouns', 'gender_pronoun'));
    const language = flat(pick(p, 'preferred_language', 'language'));
    const mrn = flat(pick(p, 'mr_number', 'mrn', 'medical_record_number'));
    const paymentMethod = flat(pick(p, 'payment_method', 'payment_method_category'));
    // Level of care / program can be charted under many field names (and is
    // sometimes nested). Cast a wide net so the ASAM level actually comes in.
    let programRaw = pick(p, 'level_of_care', 'levelOfCare', 'level_of_care_name', 'loc', 'level',
      'care_level', 'program', 'program_name', 'treatment_program', 'service', 'service_name',
      'census_program', 'bed_type', 'unit', 'track');
    if (programRaw && typeof programRaw === 'object') programRaw = programRaw.name || programRaw.label || programRaw.title || JSON.stringify(programRaw);
    let refSrcRaw = pick(p, 'referral_source', 'referrer', 'referring_provider', 'referral', 'marketing_source', 'lead_source', 'referred_by', 'referral_name', 'source_of_referral');
    let dischStatus = pick(p, 'discharge_type', 'discharge_status');
    const dischDate = pick(p, 'discharge_date', 'discharged_at');
    let dischDest = pick(p, 'discharge_destination', 'referred_to', 'aftercare_facility');
    let dischReason = pick(p, 'discharge_reason', 'discharge_note');
    const discharged = Boolean((dischDate && String(dischDate).trim()) ||
      (dischStatus && !['active', 'admitted', 'current'].includes(String(dischStatus).toLowerCase())));
    if (!discharged && kid) activeKids.push(kid);
    const existing = (kid && byKipu.get(kid)) || byName.get(name, name);

    // The census carries none of the clinical fields — pull them from the
    // patient detail (the only source of level of care, program, room,
    // referral, discharge type, and the step-down plan). Read it for active
    // clients and for anyone discharging right now; bounded + best-effort.
    let nextLoc = null, anticipatedDc = null;
    if (useDetail && kid && detailMap.has(kid)) {
      try {
        const det = detailMap.get(kid);
        if (det) {
          const d = (...keys) => { for (const k of keys) { const v = det[k]; if (v != null && String(v).trim() !== '') return Array.isArray(v) ? v.join(', ') : String(v); } return null; };
          // Kipu prefixes the utilization-review level (e.g. "UR LOC: IOP") — strip it.
          const clean = (v) => v == null ? null : String(v).replace(/^\s*UR\s*LOC\s*:?\s*/i, '').trim() || null;
          if (programRaw == null) programRaw = clean(d('level_of_care', 'program'));
          nextLoc = clean(d('next_level_of_care'));
          anticipatedDc = d('anticipated_discharge_date');
          if (refSrcRaw == null) refSrcRaw = d('referrer_name', 'first_contact_name');
          if (room == null) room = d('bed_name', 'room_name', 'building_name');
          if (dischStatus == null) dischStatus = d('discharge_type', 'discharge_type_code', 'discharge_or_transition_name');
          if (dischDest == null) dischDest = d('discharge_or_transition_name');
          if (therapist == null) therapist = deepFind(det, /(therapist|counselor|primary.?clinician)/i);
          if (caseMgr == null) caseMgr = deepFind(det, /(case.?manager|casemanager)/i);
        }
      } catch { /* best-effort */ }
    }
    const program = programRaw != null ? String(programRaw) : null;
    const newLoc = realLoc(program);
    const adm = !refSrcRaw ? admRef.get(name, p.first_name || name) : null;
    const refSource = (refSrcRaw && String(refSrcRaw)) || (adm && adm.referral_source) || null;
    if (existing) {
      // Level-of-care change: record it once, then advance the stored level.
      if (newLoc && existing.loc && newLoc !== existing.loc) {
        evt.run(existing.id, kid || null, 'loc_change', existing.loc, newLoc, today, null);
      }
      if (newLoc) db.prepare(`UPDATE clients SET loc = ? WHERE id = ?`).run(newLoc, existing.id);
      // Discharge (or AMA) transition: only when they were active until now.
      if (discharged && existing.active === 1) {
        evt.run(existing.id, kid || null, isAma(dischStatus) ? 'ama' : 'discharge', existing.loc || newLoc || null, null, (dischDate ? String(dischDate).slice(0, 10) : today), dischStatus ? String(dischStatus) : null);
      }
      // Kipu is the source of truth: set source, backfill blank descriptive
      // fields, and authoritatively set active/discharge from the census.
      db.prepare(`UPDATE clients SET source='kipu',
        kipu_id = COALESCE(kipu_id, ?),
        admit = COALESCE(NULLIF(admit,''), ?),
        admit_time = COALESCE(NULLIF(admit_time,''), ?),
        therapist = COALESCE(NULLIF(therapist,''), ?),
        case_manager = COALESCE(NULLIF(case_manager,''), ?),
        room = COALESCE(NULLIF(room,''), ?),
        program = COALESCE(NULLIF(program,''), ?),
        referral_source = COALESCE(NULLIF(referral_source,''), ?),
        dob = COALESCE(NULLIF(dob,''), ?),
        diagnosis = COALESCE(NULLIF(diagnosis,''), ?),
        insurance = COALESCE(NULLIF(insurance,''), ?),
        phone = COALESCE(NULLIF(phone,''), ?),
        pronouns = COALESCE(NULLIF(pronouns,''), ?),
        language = COALESCE(NULLIF(language,''), ?),
        mrn = COALESCE(NULLIF(mrn,''), ?),
        payment_method = COALESCE(NULLIF(payment_method,''), ?),
        next_loc = COALESCE(?, next_loc),
        anticipated_dc = COALESCE(?, anticipated_dc),
        discharge_status = ?, discharge_date = ?,
        discharge_destination = COALESCE(NULLIF(discharge_destination,''), ?),
        discharge_reason = COALESCE(NULLIF(discharge_reason,''), ?),
        active = ?
        WHERE id = ?`).run(kid || null, admit, admitTime, therapist, caseMgr, room, program, refSource,
          dob, diagnosis, insurance, phone, pronouns, language, mrn, paymentMethod,
          nextLoc, anticipatedDc,
          discharged ? (dischStatus ? String(dischStatus) : 'Discharged') : null,
          discharged ? (dischDate ? String(dischDate).slice(0, 10) : null) : null,
          dischDest, dischReason, discharged ? 0 : 1, existing.id);
      matched++;
    } else if (!discharged) {
      // Only create rows for currently-active patients.
      const info = ins.run(name, p.first_name || name, room, program, newLoc, admit, admitTime, therapist, caseMgr, refSource,
        dob, diagnosis, insurance, phone, pronouns, language, mrn, paymentMethod, nextLoc, anticipatedDc, kid || null);
      // Record an admission event only for genuinely new intakes (admitted today
      // or yesterday) — never for the initial baseline import of the standing
      // census, which would inflate past days with a one-time spike.
      if (admit && admit >= yest) evt.run(info.lastInsertRowid, kid || null, 'admit', null, newLoc, admit, null);
      created++;
    } else if (kid && dischDate) {
      // NEW + discharged: the census includes recent discharges. Defer creating
      // them until after the loop (so we know who's currently active) to capture
      // discharges that would otherwise never enter the app.
      newDischarges.push({ name, first: p.first_name, room, program, newLoc, admit, admitTime, therapist, caseMgr, refSource,
        dob, diagnosis, insurance, phone, pronouns, language, mrn, paymentMethod, nextLoc, anticipatedDc, kid,
        dischStatus, dischDate: String(dischDate).slice(0, 10), dischDest, dischReason });
    }
  }

  // Import recent discharges from the census (keyed by casefile, recent window,
  // and skipping anyone currently admitted under another casefile) so discharges
  // show up even after a Rebuild / on first run.
  let importedDischarges = 0;
  {
    const dischCutoff = new Date(Date.now() - (+(process.env.KIPU_DISCHARGE_DAYS || 30)) * 864e5).toISOString().slice(0, 10);
    const activeMasters = new Set(activeKids.map((k) => String(k).split(':')[0]));
    for (const r of newDischarges) {
      if (!r.dischDate || r.dischDate < dischCutoff) continue;
      if (byKipu.get(r.kid)) continue;                              // already have this episode
      if (activeMasters.has(String(r.kid).split(':')[0])) continue; // currently admitted elsewhere
      const info = ins.run(r.name, r.first || r.name, r.room, r.program, r.newLoc, r.admit, r.admitTime, r.therapist, r.caseMgr, r.refSource,
        r.dob, r.diagnosis, r.insurance, r.phone, r.pronouns, r.language, r.mrn, r.paymentMethod, r.nextLoc, r.anticipatedDc, r.kid);
      db.prepare(`UPDATE clients SET active = 0, discharge_status = ?, discharge_date = ?, discharge_destination = ?, discharge_reason = ? WHERE id = ?`)
        .run(r.dischStatus ? String(r.dischStatus) : 'Discharged', r.dischDate, r.dischDest || null, r.dischReason || null, info.lastInsertRowid);
      importedDischarges++;
    }
  }

  // Authoritative roster: any Kipu-sourced client NOT in the current active
  // census is no longer here — deactivate it (discharged/transferred elsewhere).
  let deactivated = 0;
  if (activeKids.length) {
    const ph = activeKids.map(() => '?').join(',');
    // Capture a discharge event for each one BEFORE we deactivate it.
    const gone = db.prepare(`SELECT id, kipu_id, loc FROM clients
      WHERE source='kipu' AND active = 1 AND (kipu_id IS NULL OR kipu_id NOT IN (${ph}))`).all(...activeKids);
    for (const g of gone) evt.run(g.id, g.kipu_id || null, 'discharge', g.loc || null, null, today, 'left census');
    // Mark them discharged (date = now) so they flow into the discharge/outcomes
    // analytics and get a "what could we have done better" debrief.
    const r = db.prepare(`UPDATE clients SET active = 0,
      discharge_status = COALESCE(NULLIF(discharge_status,''), 'Discharged'),
      discharge_date = COALESCE(NULLIF(discharge_date,''), date('now'))
      WHERE source='kipu' AND active = 1 AND (kipu_id IS NULL OR kipu_id NOT IN (${ph}))`).run(...activeKids);
    deactivated = r.changes || 0;
  }
  rollupDailyMetrics(today);   // refresh today's intake/discharge/LOC-change/AMA snapshot
  return { total: list.length, created, matched, deactivated, importedDischarges, activeNow: activeKids.length };
}

// Pull a single patient's recent clinical documentation (evaluations/notes) and
// return it as plain text for the AI risk read. Endpoint is configurable per
// Kipu account via KIPU_NOTES_PATH (use {id} for the casefile id).
const stripHtml = (s) => String(s)
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#?\w+;/g, ' ')
  .replace(/\s+/g, ' ').trim();
const extractText = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return stripHtml(v);
  if (Array.isArray(v)) return v.map(extractText).filter(Boolean).join('\n');
  if (typeof v === 'object') return Object.values(v).map(extractText).filter(Boolean).join(' ');
  return String(v);
};

// The list endpoint returns each note's name + a template tag in
// evaluation_content (e.g. "standard"); the WRITTEN text lives in the
// evaluation detail's patient_evaluation_items. So fetch detail per recent note.
export async function kipuPatientNotes(casefileId) {
  // CURRENT STAY: scope the evaluation list to this casefile (master sub-resource).
  let list = await evalListRaw(casefileId, { all: false });
  // CURRENT STAY ONLY: keep notes from the recent window so a re-admit's old
  // chart doesn't leak in — but ONLY when the list actually carries dates. Some
  // Kipu accounts return list rows with no created_at (just id/name/status); in
  // that case do NOT date-filter (it would drop everything) and rely on note-id
  // recency instead (higher id = newer). Configurable via KIPU_NOTE_DAYS.
  const noteDays = +(process.env.KIPU_NOTE_DAYS || 45);
  const noteCutoff = new Date(Date.now() - noteDays * 864e5).toISOString().slice(0, 10);
  const anyDated = list.some((e) => e.created_at);
  if (anyDated) list = list.filter((e) => !e.created_at || String(e.created_at).slice(0, 10) >= noteCutoff);
  // Narrative notes first (real free-text), then newest-first (by date, else id).
  const narrative = (nm) => /progress|nursing|group|case ?manage|family session|counsel|physician|clinical note|shift|encounter|assessment|treatment plan|biopsych|\bbht\b/i.test(nm || '');
  list.sort((a, b) => {
    const an = narrative(a.name), bn = narrative(b.name);
    if (an !== bn) return an ? -1 : 1;
    const ad = a.created_at || '', bd = b.created_at || '';
    if (ad || bd) return String(bd).localeCompare(String(ad));
    return (+b.id || 0) - (+a.id || 0);
  });
  const want = +(process.env.KIPU_NOTES_MAX || 12);
  const candidates = list.filter((e) => e.id).slice(0, want + 4);   // a few extra in case some are empty
  const debug = { candidates: list.length, anyDated, fetched: candidates.length, withContent: 0, sampleNames: [...new Set(list.map((e) => e.name).filter(Boolean))].slice(0, 8) };
  // Fetch the note details CONCURRENTLY (big speed-up vs. one-by-one).
  const results = await mapLimit(candidates, +(process.env.KIPU_CONCURRENCY || 6), async (e) => {
    try {
      const ev = await fetchEvalDetail(casefileId, e.id);
      const evDate = e.created_at || ev?.created_at || ev?.evaluation_date || ev?.date || ev?.updated_at || '';
      const body = extractText(ev?.evaluation_content);
      const bodyClean = body && !/^standard$/i.test(body.trim()) ? body : '';
      const content = [bodyClean, extractItems(ev)].filter(Boolean).join('\n').trim();
      return { e, content, date: String(evDate).slice(0, 10), author: evalAuthor(e, ev) };
    } catch { return null; }
  });
  const texts = [];
  let therapist = null, caseMgrName = null;
  for (const r of results) {
    if (!r) continue;
    const nm = r.e.name || '';
    if (r.author) {
      if (!therapist && /individual|progress|counsel|psychotherapy|\btherap|clinical note|bio.?psycho|treatment plan/i.test(nm)) therapist = r.author;
      if (!caseMgrName && /case ?manage|case ?mgmt|\bcm\b|discharge plan/i.test(nm)) caseMgrName = r.author;
    }
    if (r.content && r.content.length > 10 && texts.length < want) { debug.withContent++; texts.push(`[${r.date ? r.date + ' · ' : ''}${nm.trim() || 'Note'}]\n${r.content}`); }
  }
  return { text: texts.join('\n\n').slice(0, 18000), therapist, case_manager: caseMgrName, debug };
}

// FULL CHART: list EVERY evaluation/form on a client (all pages), light rows for
// a chart viewer. Detail is fetched on demand via kipuEvaluation.
export async function kipuPatientChart(casefileId, opts = {}) {
  let list = await evalListRaw(casefileId, { all: !!opts.all });
  list.sort((a, b) => { const ad = a.created_at || '', bd = b.created_at || ''; if (ad || bd) return String(bd).localeCompare(String(ad)); return (+b.id || 0) - (+a.id || 0); });
  return list.map((e) => ({ id: e.id ?? e.evaluation_id, name: String(e.name || 'Note').trim(), date: String(e.created_at || e.evaluation_date || e.date || '').slice(0, 10), status: e.status || '' }));
}

// Additional chart resources that are NOT patient_evaluations — medications/MAR,
// vitals, withdrawal scales (CIWA/COWS), labs, glucose, groups. Best-effort:
// tries the documented endpoint shapes and includes whatever returns; a missing
// resource is simply skipped (no error). Returns rendered entries + a diagnostic.
const EXTRA_RESOURCES = [
  { cat: 'Medications / MAR', paths: ['patient_medications', 'medications', 'patient_orders', 'orders', 'mar'] },
  { cat: 'Vital signs', paths: ['vital_signs', 'vitals'] },
  { cat: 'Withdrawal — CIWA', paths: ['ciwa_ars', 'ciwa_bs', 'ciwa'] },
  { cat: 'Withdrawal — COWS', paths: ['cows'] },
  { cat: 'Glucose', paths: ['glucose_logs', 'glucose'] },
  { cat: 'Labs / drug screens', paths: ['patient_lab_results', 'lab_results', 'laboratory_results', 'lab_orders', 'labs', 'drug_screens', 'urine_drug_screens', 'toxicology'] },
  { cat: 'Groups', paths: ['patient_group_sessions', 'group_sessions', 'groups'] },
];
function firstArray(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) { if (Array.isArray(v) && k !== 'pagination') return v; }
  return null;
}
function renderResourceRow(it) {
  if (it == null || typeof it !== 'object') return { date: '', content: String(it) };
  const date = it.created_at || it.recorded_at || it.administered_at || it.date || it.timestamp || it.scheduled_time || it.collected_at || '';
  const parts = [];
  for (const [k, v] of Object.entries(it)) {
    if (v == null || typeof v === 'object') continue;
    if (/(_id$|^id$|casefile|patient_master|^patient_id$|enterprise|location_id)/i.test(k)) continue;
    const s = String(v).trim();
    if (!s || s === 'false' || s === '0') continue;
    parts.push(`${k.replace(/_/g, ' ')}: ${s}`);
    if (parts.length >= 14) break;
  }
  return { date: String(date).slice(0, 16).replace('T', ' '), content: parts.join('\n') };
}
export async function kipuPatientExtras(casefileId) {
  const s = String(casefileId), master = s.split(':')[0], uuid = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  const phi = process.env.KIPU_PHI_LEVEL || 'high';
  const e = encodeURIComponent;
  const tryPath = async (path) => {
    for (const url of [
      `/api/patients/${master}/${path}?phi_level=${phi}&patient_master_id=${e(uuid)}`,
      `/api/${path}?patient_id=${s}`,
      `/api/patients/${e(s)}/${path}?phi_level=${phi}`,
    ]) {
      try { const d = await kipuGet(url); const arr = firstArray(d); if (arr) return arr; } catch { /* try next */ }
    }
    return null;
  };
  const entries = [], diag = [];
  // Probe all resource types CONCURRENTLY rather than one after another.
  const found = await mapLimit(EXTRA_RESOURCES, 5, async (r) => {
    let arr = null, used = null;
    for (const p of r.paths) { arr = await tryPath(p); if (arr) { used = p; break; } }
    return { r, arr, used };
  });
  for (const { r, arr, used } of found) {
    diag.push({ cat: r.cat, path: used || r.paths[0], count: arr ? arr.length : null });
    if (!arr) continue;
    arr.slice(0, 80).forEach((it, i) => {
      const row = renderResourceRow(it);
      if (row.content && row.content.length > 2) entries.push({ category: r.cat, name: r.cat + (row.date ? ' · ' + row.date : ' #' + (i + 1)), date: row.date, content: row.content });
    });
  }
  return { entries, diag };
}

// One evaluation, fully readable — for the human chart viewer. Falls back to a
// broad extract (more inclusive than the AI pull) so nothing is hidden.
export async function kipuEvaluation(casefileId, evalId) {
  const ev = await fetchEvalDetail(casefileId, evalId);
  const items = extractItems(ev);
  const body = extractText(ev?.evaluation_content);
  const bodyClean = body && !/^standard$/i.test(body.trim()) ? body : '';
  let content = [bodyClean, items].filter(Boolean).join('\n').trim();
  if (content.length < 40) { const raw = extractText(ev); if (raw && raw.length > content.length) content = raw; }  // show everything readable
  content = content.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();   // tidy for reading
  return { id: evalId, name: String(ev?.name || 'Note').trim(), date: String(ev?.created_at || ev?.evaluation_date || '').slice(0, 10), content: content.slice(0, 24000) };
}

// The clinician who signed/created an evaluation — for care-team attribution.
const AUTHOR_FIELDS = ['evaluation_signed_by', 'signed_by', 'created_by_name', 'created_by', 'completed_by', 'staff_name', 'provider_name', 'clinician_name', 'clinician', 'author', 'user_name', 'employee_name'];
function evalAuthor(...objs) {
  const okName = (v) => typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim()) && /[a-z]/i.test(v);
  for (const o of objs) { if (!o) continue; for (const k of AUTHOR_FIELDS) { if (okName(o[k])) return o[k].trim(); } }
  for (const o of objs) { if (!o) continue; const f = deepFind(o, /(signed_by|created_by|completed_by|clinician|provider|^author$|staff_name|employee_name)/i); if (okName(f)) return f.trim(); }
  return null;
}

// Pull label: value pairs out of Kipu evaluation items, keeping only REAL
// answers (drop blank/n-a/false checkbox noise, section titles, metadata).
const NOISE = new Set(['n/a', 'na', 'none', 'false', 'no', '0', 'null', '--', '', 'unknown', '.', 'n/a.', 'not applicable', 'true']);
// Find the array of evaluation items wherever it lives in the detail object.
function findItemsArray(x, depth = 0) {
  if (Array.isArray(x)) return (x[0] && typeof x[0] === 'object' && (x[0].field_type || x[0].label || x[0].name != null)) ? x : null;
  if (x && typeof x === 'object' && depth < 3) {
    for (const k of ['patient_evaluation_items', 'evaluation_items', 'items', 'records', 'patient_evaluation']) {
      if (x[k]) { const f = findItemsArray(x[k], depth + 1); if (f) return f; }
    }
    for (const v of Object.values(x)) { const f = findItemsArray(v, depth + 1); if (f) return f; }
  }
  return null;
}
function extractItems(itemsLike) {
  const items = findItemsArray(itemsLike);
  if (!items) return '';
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const ft = String(it.field_type || it.type || '').toLowerCase();
    if (ft === 'title' || ft.includes('divider') || ft.includes('golden_thread') || ft === 'evaluation_name_drop_down') continue;
    const label = stripHtml(String(it.label || it.name || it.field_name || it.question || ''));
    // Pull the answer: a string value, else checked checkbox/record options.
    let v = '';
    const raw = it.value ?? it.answer ?? it.string_value ?? it.text ?? it.description;
    if (typeof raw === 'string') v = stripHtml(raw).trim();
    else if (raw != null && typeof raw !== 'object') v = String(raw);
    if (!v && Array.isArray(it.records)) {
      const picks = it.records.map((r) => {
        const rraw = r ? (r.value ?? r.checked ?? r.answer) : null;
        const rv = String(rraw == null ? '' : rraw).toLowerCase();
        const rl = stripHtml(String((r && (r.label || r.name)) || ''));
        return (rv && rv !== 'false' && rv !== 'n/a') ? (rl || rv) : '';
      }).filter(Boolean);
      if (picks.length) v = picks.join(', ');
    }
    if (!v) continue;
    const lv = v.toLowerCase();
    if (NOISE.has(lv)) continue;
    if ((v.match(/n\/a/gi) || []).length > 1) continue;       // option dump
    if (v.replace(/[^a-z]/gi, '').length < 3) continue;        // too short to be real
    out.push(label && v.length < 90 ? `${label}: ${v}` : v);
  }
  return out.join('\n');
}

// Diagnostic: probe the documentation endpoints for ONE patient and report which
// return data + where the note text lives (so we can wire the real pull). Returns
// structure only (keys/counts), plus one short sample value, no full chart dump.
export async function kipuDocInspect(casefileId) {
  const candidates = [
    `/api/patients/${casefileId}/patient_evaluations`,
    `/api/patients/${casefileId}/evaluations`,
    `/api/patient_evaluations?patient_id=${casefileId}`,
    `/api/patients/${casefileId}/groups`,
    `/api/patients/${casefileId}/group_sessions`,
    `/api/patients/${casefileId}`,
  ];
  const probes = [];
  let evalId = null;
  for (const path of candidates) {
    try {
      const data = await kipuGet(path);
      const arr = data?.patient_evaluations || data?.evaluations || data?.groups || data?.group_sessions || (Array.isArray(data) ? data : null);
      const first = Array.isArray(arr) && arr.length ? arr[0] : null;
      probes.push({ path, ok: true, topKeys: Object.keys(data || {}).slice(0, 15), listLen: Array.isArray(arr) ? arr.length : null, firstKeys: first ? Object.keys(first) : (!arr && data ? Object.keys(data).slice(0, 40) : null) });
      if (first && !evalId && (first.id || first.evaluation_id)) evalId = first.id || first.evaluation_id;
    } catch (e) { probes.push({ path, ok: false, error: String(e.message).slice(0, 140) }); }
  }
  // Fetch one evaluation's detail to find where the note text actually lives.
  let detail = null;
  if (evalId) {
    for (const dpath of [`/api/patient_evaluations/${evalId}?patient_id=${casefileId}`, `/api/patient_evaluations/${evalId}`]) {
      try {
        const d = await kipuGet(dpath);
        const ev = d?.patient_evaluation || d?.evaluation || d;
        const items = ev?.patient_evaluation_items || ev?.items || ev?.evaluation_items;
        const it0 = Array.isArray(items) && items[0] ? items[0] : null;
        detail = { path: dpath, evalKeys: Object.keys(ev || {}).slice(0, 40), itemCount: Array.isArray(items) ? items.length : null, itemKeys: it0 ? Object.keys(it0) : null,
          sampleItems: Array.isArray(items) ? items.slice(0, 4).map((it) => Object.fromEntries(Object.entries(it || {}).slice(0, 10).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v]))) : null };
        break;
      } catch (e) { detail = { tried: dpath, error: String(e.message).slice(0, 140) }; }
    }
  }
  return { casefileId, evalId, probes, detail };
}

// Diagnostic: shows the SHAPE of the Kipu census response (field names + the
// distinct values of location/status/discharge-looking fields) so we can write
// the exact active+location filter. PHI-safe: no patient names returned.
export async function kipuInspect() {
  const path = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  const fields = list.length ? Object.keys(list[0]) : [];
  const facetKeys = fields.filter((k) => /location|program|level|facility|status|discharge|building|unit|site|admit|state|active|census/i.test(k));
  const facets = {};
  for (const k of facetKeys) {
    const vals = new Set();
    for (const p of list) { const v = p[k]; if (v != null && v !== '') vals.add(typeof v === 'object' ? JSON.stringify(v) : String(v)); if (vals.size > 40) break; }
    facets[k] = [...vals].sort();
  }
  // Also pull the location list (id -> name) so the right location_id is obvious.
  let locations = [];
  try {
    const loc = await kipuGet('/api/locations');
    const llist = loc?.locations || loc?.buildings || (Array.isArray(loc) ? loc : []);
    locations = llist.map((l) => ({ id: l.location_id ?? l.id ?? l.value, name: l.location_name ?? l.name ?? l.enabled_location_name ?? JSON.stringify(l).slice(0, 80) }));
  } catch { /* locations endpoint optional */ }
  // The census has no level-of-care field — probe one patient's DETAIL and dump
  // its structure so we can SEE exactly where the LOC/program/referral live.
  let patientDetail = null;
  const cf = list.length ? String(list[0].casefile_id ?? list[0].id ?? list[0].patient_id ?? '') : null;
  if (cf) {
    const tries = kipuDetailPaths(cf);
    const attempts = []; let det = null;
    for (const path of tries) {
      try {
        const d = await kipuGet(path);
        det = d?.patient || (Array.isArray(d?.patients) ? d.patients[0] : null) || d;
        attempts.push({ path, ok: true, wrapperKeys: Object.keys(d || {}).slice(0, 12) });
        break;
      } catch (e) { attempts.push({ path, ok: false, error: String(e.message).slice(0, 120) }); }
    }
    if (det && typeof det === 'object') {
      // One-level-deep key map (so nested LOC/program is visible).
      const nested = {};
      for (const [k, v] of Object.entries(det)) {
        if (v && typeof v === 'object') nested[k] = Array.isArray(v)
          ? `[${v.length}]` + (v[0] && typeof v[0] === 'object' ? ' of {' + Object.keys(v[0]).slice(0, 12).join(', ') + '}' : '')
          : '{' + Object.keys(v).slice(0, 12).join(', ') + '}';
      }
      // Any value that LOOKS like a level of care, anywhere — with its key path.
      const asamLike = [];
      (function scan(o, prefix, depth) {
        if (!o || typeof o !== 'object' || depth > 4) return;
        for (const [k, v] of Object.entries(o)) {
          if (v != null && typeof v !== 'object') {
            if (/\b[1-4]\.\d\b|\bwm\b|asam|level.?of.?care|\bphp\b|\biop\b|detox|residential|withdrawal/i.test(String(v)) && String(v).length < 60)
              asamLike.push(`${prefix}${k} = ${String(v).slice(0, 44)}`);
          } else scan(v, `${prefix}${k}.`, depth + 1);
        }
      })(det, '', 0);
      patientDetail = {
        casefileId: cf,
        fields: Object.keys(det).slice(0, 60),
        nested,
        levelOfCareFound: deepFind(det, LOC_KEY_RE) || '(none by key name)',
        referralFound: deepFind(det, REF_KEY_RE) || '(none by key name)',
        asamLikeValues: asamLike.slice(0, 14),
        attempts,
      };
    } else { patientDetail = { error: 'no patient detail returned', attempts }; }
  }
  return { count: list.length, topKeys: Object.keys(data || {}), fields, facets, locations, patientDetail };
}

// Kipu EMR connector. Kipu signs requests with the APIAuth (HMAC-SHA1) scheme.
// Credentials come from the environment (set them on your HIPAA host — never commit):
//   KIPU_ACCESS_ID, KIPU_SECRET_KEY, KIPU_APP_ID (a.k.a. recipient/location id),
//   KIPU_BASE_URL (default https://api.kipuapi.com)
// NOTE: the exact canonical string + roster endpoint can vary by Kipu API
// version; this implements the documented v3 pattern and is verified on first
// connect via /api/kipu/test before any sync.
import crypto from 'node:crypto';
import { db, parseLoc, rollupDailyMetrics, appToday, addDays, APP_TZ, setState, localDateOf } from './db.js';

// Kipu timestamps are UTC; admit time-of-day only makes sense in local time.
// Convert an ISO/timestamp to local HH:MM (24h). Module-level so both the sync
// and the repair backfill can use it.
function localHHMM(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) { const m = String(v).match(/[T ](\d{1,2}):(\d{2})/); return m ? String(+m[1]).padStart(2, '0') + ':' + m[2] : null; }
  const p = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  const h = p.hour === '24' ? '00' : p.hour;
  return String(h).padStart(2, '0') + ':' + p.minute;
}
// admission_date is stored at local midnight (date only); the real arrival time
// is created_at (chart opened at intake). A non-midnight admit timestamp wins.
function admitTimeFrom(admitVal, createdVal) {
  const a = localHHMM(admitVal);
  if (a && a !== '00:00') return a;
  const c = localHHMM(createdVal);
  return (c && c !== '00:00') ? c : null;
}

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

// Raw probe: report status/content-type/size for a path (to find binary endpoints).
async function kipuRawProbe(path) {
  const base = process.env.KIPU_BASE_URL || 'https://api.kipuapi.com';
  const uri = path + (path.includes('?') ? '&' : '?') + 'app_id=' + encodeURIComponent(process.env.KIPU_APP_ID);
  const contentType = 'application/vnd.kipusystems+json; version=3';
  const date = new Date().toUTCString();
  const contentMd5 = crypto.createHash('md5').update('').digest('base64');
  const canonical = [contentType, contentMd5, uri, date].join(',');
  const sig = crypto.createHmac('sha1', process.env.KIPU_SECRET_KEY).update(canonical).digest('base64');
  try {
    const r = await fetch(base + uri, { headers: { Accept: contentType, 'Content-Type': contentType, 'Content-MD5': contentMd5, Date: date, Authorization: `APIAuth ${process.env.KIPU_ACCESS_ID}:${sig}` } });
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    return { path: path.split('?')[0], status: r.status, contentType: ct, bytes: buf.length, sample: buf.length < 400 ? buf.toString('utf8').slice(0, 220) : '(binary)' };
  } catch (e) { return { path: path.split('?')[0], error: String(e.message).slice(0, 120) }; }
}

// Fetch a path that may return an image (or JSON with base64) → a data URL.
async function kipuGetBinary(path) {
  if (!kipuConfigured()) return null;
  const base = process.env.KIPU_BASE_URL || 'https://api.kipuapi.com';
  const uri = path + (path.includes('?') ? '&' : '?') + 'app_id=' + encodeURIComponent(process.env.KIPU_APP_ID);
  const contentType = 'application/vnd.kipusystems+json; version=3';
  const date = new Date().toUTCString();
  const contentMd5 = crypto.createHash('md5').update('').digest('base64');
  const canonical = [contentType, contentMd5, uri, date].join(',');
  const sig = crypto.createHmac('sha1', process.env.KIPU_SECRET_KEY).update(canonical).digest('base64');
  const r = await fetch(base + uri, { headers: { Accept: 'image/*, application/json', 'Content-Type': contentType, 'Content-MD5': contentMd5, Date: date, Authorization: `APIAuth ${process.env.KIPU_ACCESS_ID}:${sig}` } });
  if (!r.ok) return null;
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) return null;
  // Detect images by MAGIC BYTES (content-type from Kipu may be octet-stream).
  const hex = buf.slice(0, 4).toString('hex');
  if (hex.startsWith('ffd8ff')) return `data:image/jpeg;base64,${buf.toString('base64')}`;
  if (hex.startsWith('89504e47')) return `data:image/png;base64,${buf.toString('base64')}`;
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return `data:image/gif;base64,${buf.toString('base64')}`;
  if (buf.length > 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return `data:image/webp;base64,${buf.toString('base64')}`;
  if (/^image\//.test(ct)) return `data:${ct};base64,${buf.toString('base64')}`;
  // JSON wrapper: base64 field, or a URL to the image.
  try {
    const j = JSON.parse(buf.toString('utf8'));
    const b64 = j.data || j.image || j.photo || j.base64 || j.picture || j.patient_picture || j.content;
    if (b64 && typeof b64 === 'string') return /^data:/.test(b64) ? b64 : `data:${j.content_type || j.mime || 'image/jpeg'};base64,${b64}`;
    const url = j.url || j.picture_url || j.image_url || j.photo_url;
    if (url) { try { const r2 = await fetch(url); if (r2.ok) { const b2 = Buffer.from(await r2.arrayBuffer()); return `data:${r2.headers.get('content-type') || 'image/jpeg'};base64,${b2.toString('base64')}`; } } catch { /* url fetch failed */ } }
  } catch { /* not json */ }
  return null;
}
// A patient's photo (for face-matching), best-effort across endpoint shapes.
export async function kipuPatientPhoto(casefileId) {
  const s = String(casefileId), master = s.split(':')[0], uuid = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
  const phi = process.env.KIPU_PHI_LEVEL || 'high', e = encodeURIComponent;
  const q = `phi_level=${phi}&patient_master_id=${e(uuid)}`;
  for (const path of [
    `/api/patients/${master}/patient_picture?${q}`,
    `/api/patients/${master}/picture?${q}`,
    `/api/patients/${master}/photo?${q}`,
    `/api/patients/${master}/image?${q}`,
    `/api/patients/${master}/patient_image?${q}`,
    `/api/patients/${master}/avatar?${q}`,
    `/api/patients/${e(uuid)}/patient_picture?phi_level=${phi}&patient_master_id=${master}`,
  ]) { try { const d = await kipuGetBinary(path); if (d) return d; } catch { /* try next */ } }
  return null;
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
// Pull a human name out of a value that may be a plain string or an object —
// Kipu stores providers either way ("Jane Doe" or {first_name, last_name} / {name}).
function nameFrom(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const direct = v.name || v.full_name || v.fullName || v.display_name || v.displayName
      || v.staff_name || v.provider_name || v.employee_name || v.clinician_name;
    if (direct && String(direct).trim()) return String(direct).trim();
    const fn = v.first_name || v.firstName, ln = v.last_name || v.lastName;
    if (fn || ln) return [fn, ln].filter(Boolean).join(' ').trim() || null;
  }
  return null;
}
// Keys that match a role word but hold something other than a person's name
// (e.g. therapist_notes, case_manager_id, therapist_signature) — never a name.
const NOISE_KEY = /(notes?|comments?|signature|reason|plan|summary|status|count|score|date|_id|^id|_at)$/i;
function deepFind(obj, keyRe, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const [k, v] of Object.entries(obj)) {
    // Match the key, then pull a name whether the value is a string OR an object
    // ({primary_therapist: {name: "..."}}). Skip noise keys so we don't grab a
    // note/signature/id as the "name".
    if (keyRe.test(k) && !NOISE_KEY.test(k)) { const nm = nameFrom(v); if (nm) return nm; }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const f = deepFind(v, keyRe, depth + 1); if (f) return f; }
  }
  return null;
}
// Kipu often lists the care/treatment team as an array of {role|title, name}.
// Find the member whose role matches and return their name.
function findTeamMember(obj, roleRe, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  const arrays = Array.isArray(obj) ? [obj] : Object.values(obj).filter(Array.isArray);
  for (const arr of arrays) {
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const role = it.role || it.title || it.role_name || it.type || it.position || it.relationship || it.staff_role || '';
      if (roleRe.test(String(role))) { const nm = nameFrom(it) || nameFrom(it.staff) || nameFrom(it.provider); if (nm) return nm; }
    }
  }
  if (!Array.isArray(obj)) for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const f = findTeamMember(v, roleRe, depth + 1); if (f) return f; }
  }
  return null;
}
const LOC_KEY_RE = /(level.*of.*care|levelofcare|^loc$|care.?level|^asam|asam.?level|program|treatment.?track|^level$|^track$)/i;
const REF_KEY_RE = /(referr|marketing.?source|lead.?source|source.?of|referral)/i;
// Fetch one patient's full record (the census omits LOC/program/referral).
// Reconcile the live Kipu census (this location, active) against the app's
// active roster — pinpoints exactly which clients differ and why. PHI-safe
// (casefile id + initials only).
export async function kipuReconcile() {
  let path = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  const locId = (process.env.KIPU_LOCATION_ID || '').trim();
  if (locId && !/location_id=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const wantLoc = (process.env.KIPU_LOCATION || '').trim().toLowerCase();
  const matchesLoc = (p) => {
    if (locId) { const id = pick(p, 'location_id', 'locationId', 'location'); return id != null && String(id) === locId; }
    if (!wantLoc) return true;
    return Object.values(p).some((v) => typeof v === 'string' && v.toLowerCase().includes(wantLoc));
  };
  const initials = (p) => ((String(p.first_name || ' ')[0]) + (String(p.last_name || ' ')[0])).toUpperCase();
  const censusActive = [], censusDischarged = [];
  let otherLoc = 0;
  for (const p of list) {
    const kid = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn');
    if (!matchesLoc(p)) { otherLoc++; continue; }
    const dischDate = pick(p, 'discharge_date', 'discharged_at'), dischStatus = pick(p, 'discharge_type', 'discharge_status');
    const discharged = Boolean((dischDate && String(dischDate).trim()) || (dischStatus && !['active', 'admitted', 'current'].includes(String(dischStatus).toLowerCase())));
    (discharged ? censusDischarged : censusActive).push({ kid: kid ? String(kid) : null, initials: initials(p) });
  }
  const appActive = db.prepare(`SELECT kipu_id, pref, name FROM clients WHERE active = 1 AND discharge_status IS NULL AND source = 'kipu'`).all();
  const appKids = new Set(appActive.map((c) => c.kipu_id).filter(Boolean));
  const censusKids = new Set(censusActive.map((c) => c.kid).filter(Boolean));
  const byKipu = db.prepare(`SELECT active, discharge_status FROM clients WHERE kipu_id = ?`);
  const missingFromApp = censusActive.filter((c) => c.kid && !appKids.has(c.kid)).map((c) => { const r = byKipu.get(c.kid); return { kid: c.kid, initials: c.initials, inApp: !!r, appActive: r ? r.active : null, appStatus: r ? r.discharge_status : null }; });
  const staleInApp = appActive.filter((c) => c.kipu_id && !censusKids.has(c.kipu_id)).map((c) => ({ kid: c.kipu_id, initials: (String(c.pref || c.name || ' ')[0]).toUpperCase() }));
  return { locationId: locId || '(none)', censusTotal: list.length, otherLocations: otherLoc, censusActiveAtLocation: censusActive.length, censusDischargedAtLocation: censusDischarged.length, appActive: appActive.length, missingFromApp, staleInApp };
}

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
  const seenKids = new Set();    // de-dupe: the census feed can return the same casefile twice
  const claimedRows = new Set(); // app rows already taken this sync — never merge two people onto one
  const byKipu = db.prepare(`SELECT id, loc, active FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id, loc, active, kipu_id FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, loc, admit, admit_time, therapist, case_manager, referral_source, dob, diagnosis, allergies, insurance, phone, pronouns, language, mrn, payment_method, next_loc, anticipated_dc, kipu_id, source, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'kipu', 1)`);
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
  const timeOf = (v) => {
    if (!v) return null;
    const s = String(v);
    let m = s.match(/[T ](\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/) || s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
    if (!m) return null;
    let h = +m[1]; const min = m[2]; const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || +min > 59) return null;
    return String(h).padStart(2, '0') + ':' + min;
  };
  const activeKids = [];   // census patients who are currently active (no discharge)

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
    if (kid && seenKids.has(kid)) continue;   // same casefile twice in the feed — process it once
    if (kid) seenKids.add(kid);
    const admitRaw = pick(p, 'admission_date', 'admit_date', 'admitted_at');
    const admit = localDateOf(admitRaw);   // Eastern calendar day (UTC instants don't roll to "tomorrow")
    if (admitCutoff && admit && admit < admitCutoff) continue;   // opt-in recency filter
    // admission_date is stored at local midnight (date only); the real arrival
    // time is created_at (chart opened at intake). Both converted to local TZ.
    let admitTime = admitTimeFrom(admitRaw, pick(p, 'created_at', 'created_date'));
    let therapist = nameFrom(pick(p, 'primary_therapist', 'therapist', 'counselor', 'primary_clinician', 'clinician'));
    let caseMgr = nameFrom(pick(p, 'case_manager', 'casemanager', 'case_manager_name'));
    let room = pick(p, 'bed_name', 'bed_number', 'room_number', 'room_name', 'room', 'bed', 'bed_label', 'bed_name_full');
    // Demographics the census DOES carry — map them straight through.
    const flat = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v != null ? String(v) : null);
    // Allergies may be a string, a list of strings, or a list of objects — pull
    // the human-readable allergen name out of whichever shape Kipu returns.
    const flatAllergies = (v) => {
      if (v == null) return null;
      const names = (Array.isArray(v) ? v : [v]).map((a) => {
        if (a == null) return '';
        if (typeof a === 'object') return a.name || a.allergen || a.allergy || a.label || a.description || a.value || '';
        return String(a);
      }).map((s) => String(s).trim()).filter(Boolean);
      return names.length ? [...new Set(names)].join(', ') : null;
    };
    const dob = flat(pick(p, 'dob', 'date_of_birth'));
    const allergies = flatAllergies(pick(p, 'allergies', 'allergy', 'allergies_list', 'drug_allergies', 'patient_allergies', 'known_allergies'));
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
    // Match by casefile id first. Only fall back to a NAME match when that row
    // isn't already tied to a DIFFERENT Kipu casefile — otherwise two different
    // people who happen to share a name collapse onto one record, under-counting
    // the census and today's admits. (A row with no kipu_id is a manually-added
    // client that's safe to link.)
    const nameRow = byName.get(name, name);
    const safeName = nameRow && (!nameRow.kipu_id || nameRow.kipu_id === kid) ? nameRow : null;
    let existing = (kid && byKipu.get(kid)) || safeName;
    if (existing && claimedRows.has(existing.id)) existing = null;   // row already taken this sync → make a new one

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
          // Admission time-of-day: admission_date is date-only (local midnight),
          // so use the chart's created_at (intake) as the real arrival time,
          // converted to local TZ. A non-midnight admission timestamp still wins.
          if (!admitTime) admitTime = admitTimeFrom(d('admission_date', 'admitted_at', 'admission_datetime', 'admission_time'), d('created_at', 'created_date'));
          nextLoc = clean(d('next_level_of_care'));
          anticipatedDc = d('anticipated_discharge_date');
          if (refSrcRaw == null) refSrcRaw = d('referrer_name', 'first_contact_name');
          if (room == null) room = d('bed_name', 'bed_number', 'room_name', 'room_number', 'room', 'bed', 'bed_label');
          if (dischStatus == null) dischStatus = d('discharge_type', 'discharge_type_code', 'discharge_or_transition_name');
          if (dischDest == null) dischDest = d('discharge_or_transition_name');
          if (therapist == null) therapist = deepFind(det, /(primary.?therapist|therapist|counselor|primary.?clinician)/i) || findTeamMember(det, /therap|counsel|clinician/i);
          if (caseMgr == null) caseMgr = deepFind(det, /(case.?manager|casemanager|case.?mgmt)/i) || findTeamMember(det, /case.?manage|case.?mgmt|\bcm\b/i);
        }
      } catch { /* best-effort */ }
    }
    // Guard: a bed/room is never the facility/building name (e.g. "Armada
    // Recovery") — that's not a bed. Drop it so the room shows blank, not wrong.
    if (room && /\barmada\b/i.test(String(room)) && !/\d/.test(String(room))) room = null;
    const program = programRaw != null ? String(programRaw) : null;
    const newLoc = realLoc(program);
    const adm = !refSrcRaw ? admRef.get(name, p.first_name || name) : null;
    const refSource = (refSrcRaw && String(refSrcRaw)) || (adm && adm.referral_source) || null;
    if (existing) {
      claimedRows.add(existing.id);   // this app row is now spoken for this sync
      // Level-of-care change: record it once, then advance the stored level.
      if (newLoc && existing.loc && newLoc !== existing.loc) {
        evt.run(existing.id, kid || null, 'loc_change', existing.loc, newLoc, today, null);
      }
      if (newLoc) db.prepare(`UPDATE clients SET loc = ? WHERE id = ?`).run(newLoc, existing.id);
      // Discharge (or AMA) transition: only when they were active until now.
      if (discharged && existing.active === 1) {
        evt.run(existing.id, kid || null, isAma(dischStatus) ? 'ama' : 'discharge', existing.loc || newLoc || null, null, (localDateOf(dischDate) || today), dischStatus ? String(dischStatus) : null);
        // Flag the vacated bed for turnover (RT bed board), unless already flagged.
        try {
          const cl = db.prepare(`SELECT room, pref, name FROM clients WHERE id = ?`).get(existing.id);
          const bed = (cl && cl.room ? String(cl.room).trim() : '');
          if (bed && !db.prepare(`SELECT 1 FROM bed_turnovers WHERE room = ? AND status = 'dirty' LIMIT 1`).get(bed)) {
            db.prepare(`INSERT INTO bed_turnovers (room, who, reason) VALUES (?,?,?)`).run(bed, (cl.pref || (cl.name || '').split(/\s+/)[0] || null), 'discharge');
          }
        } catch { /* bed board optional */ }
      }
      // Kipu is the source of truth: set source, backfill blank descriptive
      // fields, and authoritatively set active/discharge from the census.
      db.prepare(`UPDATE clients SET source='kipu',
        kipu_id = COALESCE(?, kipu_id),
        admit = COALESCE(NULLIF(admit,''), ?),
        admit_time = COALESCE(NULLIF(admit_time,''), ?),
        therapist = COALESCE(NULLIF(?,''), NULLIF(therapist,'')),
        case_manager = COALESCE(NULLIF(?,''), NULLIF(case_manager,'')),
        room = COALESCE(NULLIF(room,''), ?),
        program = COALESCE(NULLIF(program,''), ?),
        referral_source = COALESCE(NULLIF(referral_source,''), ?),
        dob = COALESCE(NULLIF(dob,''), ?),
        diagnosis = COALESCE(NULLIF(diagnosis,''), ?),
        allergies = COALESCE(NULLIF(allergies,''), ?),
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
          dob, diagnosis, allergies, insurance, phone, pronouns, language, mrn, paymentMethod,
          nextLoc, anticipatedDc,
          discharged ? (dischStatus ? String(dischStatus) : 'Discharged') : null,
          discharged ? localDateOf(dischDate) : null,
          dischDest, dischReason, discharged ? 0 : 1, existing.id);
      matched++;
    } else if (!discharged) {
      // Only create rows for currently-active patients.
      const info = ins.run(name, p.first_name || name, room, program, newLoc, admit, admitTime, therapist, caseMgr, refSource,
        dob, diagnosis, allergies, insurance, phone, pronouns, language, mrn, paymentMethod, nextLoc, anticipatedDc, kid || null);
      claimedRows.add(info.lastInsertRowid);   // brand-new active row — seen this sync, never sweep it
      // Record an admission event only for genuinely new intakes (admitted today
      // or yesterday) — never for the initial baseline import of the standing
      // census, which would inflate past days with a one-time spike.
      if (admit && admit >= yest) evt.run(info.lastInsertRowid, kid || null, 'admit', null, newLoc, admit, null);
      created++;
    }
  }

  // Discharges are NOT in the plain census (it's active-only). The DATE-RANGED
  // census returns them, so pull the recent window and import discharged
  // patients we don't already have, enriching each with its detail (type/reason).
  let importedDischarges = 0;
  // Real discharge dates from the date-ranged feed, keyed by casefile id and by
  // master id — so "gone from census" clients get their ACTUAL discharge date
  // (not today's), which keeps the daily/period counts honest on a backfill.
  const dischargeDateByKid = new Map();
  if (process.env.KIPU_DISCHARGE_SYNC !== 'false') {
    try {
      const dDays = +(process.env.KIPU_DISCHARGE_DAYS || 30);
      const start = new Date(Date.now() - dDays * 864e5).toISOString().slice(0, 10);
      const phi = process.env.KIPU_PHI_LEVEL || 'high';
      let dpath = `/api/patients/census?phi_level=${phi}&start_date=${start}&end_date=${appToday()}`;
      if (locId) dpath += `&location_id=${encodeURIComponent(locId)}`;
      const dd = await kipuGet(dpath);
      const dlist = dd?.patients || dd?.census || (Array.isArray(dd) ? dd : []);
      const activeMasters = new Set(activeKids.map((k) => String(k).split(':')[0]));
      const flat2 = (v) => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v != null ? String(v) : null);
      const toImport = [];
      for (const p of dlist) {
        if (!matchesLoc(p)) continue;
        const dRaw = pick(p, 'discharge_date', 'discharged_at');
        if (!dRaw || !String(dRaw).trim()) continue;
        const kraw = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn'); if (!kraw) continue;
        const ks = String(kraw);
        const dOnly = localDateOf(dRaw);
        dischargeDateByKid.set(ks, dOnly);
        dischargeDateByKid.set(ks.split(':')[0], dOnly);           // also by master id
        if (byKipu.get(ks)) continue;                              // already have this episode
        if (activeMasters.has(ks.split(':')[0])) continue;         // currently admitted under another casefile
        toImport.push({ p, kid: ks, dDate: dOnly });
      }
      const enriched = await mapLimit(toImport, +(process.env.KIPU_CONCURRENCY || 6), async (x) => {
        let det = null; try { det = await kipuPatientDetail(x.kid); } catch { /* best-effort */ }
        return { ...x, det };
      });
      const seenNow = new Set();
      for (const { p, kid, dDate, det } of enriched) {
        if (seenNow.has(kid) || byKipu.get(kid)) continue; seenNow.add(kid);
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
        if (!name) continue;
        const g = (...keys) => { if (!det) return null; for (const k of keys) { const v = det[k]; if (v != null && String(v).trim() !== '') return Array.isArray(v) ? v.join(', ') : String(v); } return null; };
        const cleanLoc = (v) => v == null ? null : String(v).replace(/^\s*UR\s*LOC\s*:?\s*/i, '').trim() || null;
        const admit = localDateOf(pick(p, 'admission_date', 'admit_date') || g('admission_date'));
        const admitTimeD = admitTimeFrom(pick(p, 'admission_date', 'admit_date', 'admitted_at') || g('admission_date'), pick(p, 'created_at', 'created_date') || g('created_at'));
        const program = cleanLoc(g('level_of_care', 'program'));
        const info = ins.run(name, p.first_name || name, g('bed_name', 'bed_number', 'room_name', 'room_number', 'room', 'bed'), program, realLoc(program), admit, admitTimeD, null, null,
          g('referrer_name', 'first_contact_name'), flat2(pick(p, 'dob', 'date_of_birth')), flat2(pick(p, 'diagnosis_codes')),
          flat2(pick(p, 'insurance_company')), flat2(pick(p, 'phone')), flat2(pick(p, 'pronouns')), flat2(pick(p, 'preferred_language')),
          flat2(pick(p, 'mr_number')), null, null, null, kid);
        db.prepare(`UPDATE clients SET active = 0, discharge_status = ?, discharge_date = ?, discharge_destination = ?, discharge_reason = ?, discharged_by_kipu = ? WHERE id = ?`)
          .run(g('discharge_type', 'discharge_type_code', 'discharge_or_transition_name') || 'Discharged', dDate, g('discharge_or_transition_name'), g('discharge_reason'),
            g('discharged_by', 'discharge_clinician', 'discharged_by_name') || deepFind(det, /discharg.*(by|clinician|provider|staff)|disposition.*by/i) || null, info.lastInsertRowid);
        importedDischarges++;
      }
    } catch (e) { /* discharge feed optional */ }
  }

  // Authoritative roster: any Kipu-sourced client we did NOT see in this census is
  // no longer here — deactivate it. We key on "claimed this sync" (matched to a
  // census patient by id OR name, or newly inserted), NOT on kipu_id string matching
  // — otherwise a patient whose casefile id changed (re-admission) looks "gone" even
  // though they're standing right there in the census, which churns phantom
  // discharges + re-admits and skews the weekly counts.
  let deactivated = 0;
  if (activeKids.length) {
    const activeRows = db.prepare(`SELECT id, kipu_id, loc, discharge_date FROM clients WHERE source='kipu' AND active = 1`).all();
    const gone = activeRows.filter((g) => !claimedRows.has(g.id));
    // SAFEGUARD: a partial / failed census pull (pagination, location filter, network)
    // would make almost everyone look "gone". Never mass-discharge — if we'd drop more
    // than half the roster (and more than a handful), treat the census as incomplete,
    // skip the sweep, and flag it for review.
    const ratio = activeRows.length ? gone.length / activeRows.length : 0;
    const maxPct = (+(process.env.KIPU_MAX_DEACTIVATE_PCT || 50)) / 100;
    if (gone.length > 8 && ratio > maxPct) {
      const warn = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} — skipped deactivating ${gone.length}/${activeRows.length} (${Math.round(ratio * 100)}%); census looked partial`;
      setState('kipu_census_warn', warn);
      console.warn('[kipu] ' + warn);
    } else {
      // Use the real discharge date from the date-ranged feed when we have it;
      // only fall back to today when Kipu gives us nothing (truly unknown).
      const realDate = (g) => {
        if (g.discharge_date && String(g.discharge_date).trim()) return localDateOf(g.discharge_date);
        const k = g.kipu_id ? String(g.kipu_id) : '';
        return dischargeDateByKid.get(k) || dischargeDateByKid.get(k.split(':')[0]) || today;
      };
      const setGone = db.prepare(`UPDATE clients SET active = 0,
        discharge_status = COALESCE(NULLIF(discharge_status,''), 'Discharged'),
        discharge_date = COALESCE(NULLIF(discharge_date,''), ?) WHERE id = ?`);
      for (const g of gone) {
        const dd = realDate(g);
        evt.run(g.id, g.kipu_id || null, 'discharge', g.loc || null, null, dd, 'left census');
        setGone.run(dd, g.id);
        deactivated++;
      }
    }
  }
  // Pull patient photos for face-matching — active clients missing one, in
  // parallel, best-effort. Once set they're skipped on later syncs.
  let photos = 0;
  if (process.env.KIPU_PHOTO_SYNC !== 'false') {
    const noPhoto = db.prepare(`SELECT id, kipu_id FROM clients WHERE source='kipu' AND active = 1 AND kipu_id IS NOT NULL AND (photo IS NULL OR photo = '')`).all();
    const setP = db.prepare(`UPDATE clients SET photo = ? WHERE id = ?`);
    const got = await mapLimit(noPhoto, +(process.env.KIPU_CONCURRENCY || 6), async (c) => { let ph = null; try { ph = await kipuPatientPhoto(c.kipu_id); } catch { /* best-effort */ } return { id: c.id, ph }; });
    for (const x of got) if (x.ph) { setP.run(x.ph, x.id); photos++; }
  }
  rollupDailyMetrics(today);   // refresh today's intake/discharge/LOC-change/AMA snapshot
  // Record the real moment of this sync (SQLite-UTC format) so the Command Center
  // can show "Kipu · synced Xm ago" accurately — clients.updated_at is insert-only.
  setState('kipu_last_sync', new Date().toISOString().slice(0, 19).replace('T', ' '));
  return { total: list.length, created, matched, deactivated, importedDischarges, photos, activeNow: activeKids.length };
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
// Which key chart forms (by name) exist for this client — authoritative from
// Kipu, not inferred. Used for documentation compliance.
const FORM_PATTERNS = {
  biopsych: /biopsych|bio-psycho|psychosocial/i,
  tx_plan: /treatment plan|tx plan|master treatment|individualized (treatment|service)|service plan/i,
  asam: /\basam\b|level of care assessment|continued (service|stay)/i,
  cm_note: /case ?manage|cm note|discharge plan/i,
  nursing: /nursing (assessment|admission|eval)/i,
  hp: /history (and|&) physical|\bh ?& ?p\b|physical exam/i,
};
function formsPresent(names) {
  const out = {};
  for (const [k, re] of Object.entries(FORM_PATTERNS)) out[k] = names.some((n) => re.test(n));
  return out;
}
export async function kipuPatientNotes(casefileId) {
  // CURRENT STAY: scope the evaluation list to this casefile (master sub-resource).
  let list = await evalListRaw(casefileId, { all: false });
  const forms = formsPresent(list.map((e) => String(e.name || '')));
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
  const want = +(process.env.KIPU_NOTES_MAX || 8);
  const candidates = list.filter((e) => e.id).slice(0, want + 3);   // a few extra in case some are empty
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
  return { text: texts.join('\n\n').slice(0, +(process.env.KIPU_NOTES_CHARS || 9000)), therapist, case_manager: caseMgrName, forms, debug };
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

// Rounds / observation forms are charted as evaluations. Match by name.
const ROUNDS_RE = new RegExp(process.env.KIPU_ROUNDS_PATTERN ||
  'round|q ?15|q ?30|q ?60|15 ?min|30 ?min|hourly|observation|safety ?check|bed ?check|whereabouts|precaution|loc(?:ation)? ?check|sleep ?check|visual ?check|monitor', 'i');

// DIAGNOSTIC: dump the form names on a real (active) client so we can see what
// the rounds form is actually called, and which names match the rounds pattern.
export async function kipuFindRounds(nameQuery) {
  const c = (nameQuery && String(nameQuery).trim())
    ? db.prepare(`SELECT kipu_id, pref, name FROM clients WHERE source = 'kipu' AND kipu_id IS NOT NULL AND kipu_id != '' AND (name LIKE ? OR pref LIKE ?) ORDER BY active DESC, id DESC LIMIT 1`).get('%' + nameQuery.trim() + '%', '%' + nameQuery.trim() + '%')
    : db.prepare(`SELECT kipu_id, pref, name FROM clients WHERE active = 1 AND source = 'kipu' AND kipu_id IS NOT NULL AND kipu_id != '' ORDER BY id LIMIT 1`).get();
  if (!c) return { error: nameQuery ? `No client matching "${nameQuery}" — check the name, or sync the roster.` : 'No active Kipu client in the app — sync the roster first.' };
  // Look across ALL stays so we see the full chart (and tell which forms exist).
  const list = await evalListRaw(c.kipu_id, { all: true });
  const names = [...new Set(list.map((e) => String(e.name || '').trim()).filter(Boolean))];
  const counts = {};
  for (const e of list) { const n = String(e.name || '').trim(); if (n) counts[n] = (counts[n] || 0) + 1; }
  // Which forms match each compliance category — so we can verify treatment plan etc.
  const categoryMatches = {};
  for (const [k, re] of Object.entries(FORM_PATTERNS)) categoryMatches[k] = names.filter((n) => re.test(n));
  categoryMatches.rounds = names.filter((n) => ROUNDS_RE.test(n));
  return {
    client: (String(c.pref || c.name || ' ').split(' ')[0] || '?'), casefileId: c.kipu_id,
    totalForms: list.length,
    categoryMatches,
    topByCount: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, k]) => `${k}× ${n}`),
    distinctNames: names.slice(0, 90),
  };
}

// The latest rounds (observation evals) for a client, with real timestamps
// (the list lacks dates on some accounts, so fetch detail for the newest few).
export async function kipuClientRounds(casefileId, max = 6) {
  const list = await evalListRaw(casefileId, { all: false });
  const round = list.filter((e) => ROUNDS_RE.test(String(e.name || ''))).slice(0, max);
  const out = await mapLimit(round, +(process.env.KIPU_CONCURRENCY || 6), async (e) => {
    let ts = e.created_at || '', by = null;
    if (!ts) { try { const ev = await fetchEvalDetail(casefileId, e.id); ts = ev?.created_at || ev?.evaluation_date || ev?.updated_at || ''; by = evalAuthor(e, ev); } catch { /* skip */ } }
    return { eval_id: String(e.id), name: String(e.name || 'Round').trim(), ts, by };
  });
  return out.filter((r) => r.ts);
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
  // Admit-time reality check: dump admission_date + created_at across many
  // patients, so we can SEE whether admission_date carries a real time-of-day
  // (varies) or is always midnight (date-only, so created_at is the real time).
  const admitTimeSamples = list.slice(0, 15).map((p) => ({
    admission_date: p.admission_date ?? null,
    created_at: p.created_at ?? null,
    last_updated_at: p.last_updated_at ?? null,
  }));
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
      // Any key that looks admission/time-related, anywhere — with its value,
      // so we can see exactly what field carries the admit time and its format.
      const timeLike = [];
      (function scan(o, prefix, depth) {
        if (!o || typeof o !== 'object' || depth > 4) return;
        for (const [k, v] of Object.entries(o)) {
          if (v != null && typeof v !== 'object') {
            if (/admit|admission|intake|arriv|\btime\b|created_at|_at$|date/i.test(k) && String(v).length < 48)
              timeLike.push(`${prefix}${k} = ${String(v)}`);
          } else scan(v, `${prefix}${k}.`, depth + 1);
        }
      })(det, '', 0);
      // The raw census row's admission/time fields (the other possible source).
      const censusTimeFields = [];
      for (const [k, v] of Object.entries(list[0] || {})) {
        if (v != null && typeof v !== 'object' && /admit|admission|intake|arriv|\btime\b|date|_at$/i.test(k))
          censusTimeFields.push(`${k} = ${String(v).slice(0, 48)}`);
      }
      patientDetail = {
        casefileId: cf,
        fields: Object.keys(det).slice(0, 60),
        nested,
        levelOfCareFound: deepFind(det, LOC_KEY_RE) || '(none by key name)',
        referralFound: deepFind(det, REF_KEY_RE) || '(none by key name)',
        therapistFound: deepFind(det, /(primary.?therapist|therapist|counselor|primary.?clinician)/i) || findTeamMember(det, /therap|counsel|clinician/i) || '(none found)',
        caseManagerFound: deepFind(det, /(case.?manager|casemanager|case.?mgmt)/i) || findTeamMember(det, /case.?manage|case.?mgmt|\bcm\b/i) || '(none found)',
        asamLikeValues: asamLike.slice(0, 14),
        admitTimeFields_detail: timeLike.slice(0, 30),
        admitTimeFields_census: censusTimeFields,
        attempts,
      };
    } else { patientDetail = { error: 'no patient detail returned', attempts }; }
  }
  // Discharge analysis: is the census carrying any discharges, and is there a
  // date-ranged feed that returns them? This decides how we source discharges.
  const hasDc = (p) => { const dd = p.discharge_date || p.discharged_at; const dt = p.discharge_type || p.discharge_status; return (dd && String(dd).trim()) || (dt && !['active', 'admitted', 'current', ''].includes(String(dt).toLowerCase())); };
  const dischargedRows = list.filter(hasDc);
  const todayStr = new Date().toISOString().slice(0, 10);
  const startStr = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const dischargeAnalysis = {
    censusTotal: list.length,
    censusWithDischargeDate: dischargedRows.length,
    sampleDischargeFields: dischargedRows.slice(0, 3).map((p) => ({ discharge_date: p.discharge_date, discharge_type: p.discharge_type, discharge_status: p.discharge_status, location_id: p.location_id })),
    probes: [],
  };
  for (const c of [
    `/api/patients/census?start_date=${startStr}&end_date=${todayStr}`,
    `/api/patients/census?phi_level=high&start_date=${startStr}&end_date=${todayStr}`,
    `/api/patients/occupancy?start_date=${startStr}&end_date=${todayStr}`,
    `/api/patients/latest`,
  ]) {
    try {
      const d = await kipuGet(c);
      const arr = d?.patients || d?.census || (Array.isArray(d) ? d : null);
      dischargeAnalysis.probes.push({ path: c, ok: true, rows: Array.isArray(arr) ? arr.length : null, withDischargeDate: Array.isArray(arr) ? arr.filter(hasDc).length : null });
    } catch (e) { dischargeAnalysis.probes.push({ path: c, ok: false, error: String(e.message).slice(0, 100) }); }
  }
  // Photo probe: try several picture endpoint shapes and report what each returns.
  let photoProbe = null;
  if (cf) {
    const m = cf.split(':')[0], u = cf.includes(':') ? cf.slice(cf.indexOf(':') + 1) : cf, phi = process.env.KIPU_PHI_LEVEL || 'high', e = encodeURIComponent;
    const q = `phi_level=${phi}&patient_master_id=${e(u)}`;
    const paths = [
      `/api/patients/${m}/patient_picture?${q}`,
      `/api/patients/${m}/picture?${q}`,
      `/api/patients/${m}/photo?${q}`,
      `/api/patients/${m}/image?${q}`,
      `/api/patients/${m}/patient_image?${q}`,
      `/api/patients/${m}/avatar?${q}`,
      `/api/patients/${m}/patient_picture`,
      `/api/patients/${e(cf)}/patient_picture?phi_level=${phi}`,
    ];
    photoProbe = await mapLimit(paths, 4, (p) => kipuRawProbe(p));
  }
  // Rounds probe: find where Kipu serves hourly/observation rounds. Try patient-
  // scoped and facility date-ranged shapes; also see if rounds are charted as
  // evaluations (count eval names containing "round").
  let roundsProbe = null;
  {
    const phi = process.env.KIPU_PHI_LEVEL || 'high', e = encodeURIComponent;
    const m = cf ? cf.split(':')[0] : '', u = cf && cf.includes(':') ? cf.slice(cf.indexOf(':') + 1) : cf;
    const start = startStr, today = todayStr;
    const cands = [
      `/api/rounds?start_date=${start}&end_date=${today}`,
      `/api/patient_rounds?start_date=${start}&end_date=${today}`,
      `/api/rounds?phi_level=${phi}&start_date=${start}&end_date=${today}`,
      `/api/scheduler/rounds?start_date=${start}&end_date=${today}`,
      cf ? `/api/patients/${m}/rounds?phi_level=${phi}&patient_master_id=${e(u)}` : null,
      cf ? `/api/patients/${m}/patient_rounds?phi_level=${phi}&patient_master_id=${e(u)}` : null,
    ].filter(Boolean);
    const probes = await mapLimit(cands, 4, (p) => kipuRawProbe(p));
    // Are rounds charted as evaluations? (the facet/name approach)
    let roundEvalNames = null;
    if (cf) { try { const ev = await evalListRaw(cf, { all: true }); roundEvalNames = [...new Set(ev.map((x) => x.name).filter((n) => /round|q15|q ?15|observation|safety check|bed ?check/i.test(n || '')))].slice(0, 8); } catch { /* ignore */ } }
    roundsProbe = { probes, roundEvalNames };
  }
  // Care-team probe: WHERE does Kipu actually store the assigned therapist /
  // case manager? Scan several patients' full detail and dump every key path
  // (any depth) whose key looks person/role-related, with its value — plus the
  // shape of any team/provider arrays. This is how we find the real field name
  // when the kiosk shows "no therapist / no case manager".
  const careTeamProbe = { sampled: 0, scalarHits: [], arrayShapes: [], note: 'Look for the key whose value is the assigned therapist / case manager name.' };
  try {
    const KEY_RE = /therap|counsel|clinician|case.?manage|case.?mgmt|\bcm\b|provider|primary|assigned|care.?team|treatment.?team|\bstaff\b|employee|attending|social.?work|\bmsw\b|\blcsw\b/i;
    const seenPaths = new Set();
    const scan = (o, path, depth) => {
      if (!o || typeof o !== 'object' || depth > 5) return;
      if (Array.isArray(o)) {
        if (o.length && typeof o[0] === 'object' && KEY_RE.test(path)) {
          const shape = `${path} [${o.length}] of { ${Object.keys(o[0]).slice(0, 14).join(', ')} }`;
          if (!seenPaths.has(shape)) { seenPaths.add(shape); careTeamProbe.arrayShapes.push({ shape, sample: JSON.stringify(o[0]).slice(0, 300) }); }
        }
        o.slice(0, 4).forEach((it, i) => scan(it, `${path}[${i}]`, depth + 1));
        return;
      }
      for (const [k, v] of Object.entries(o)) {
        const p = path ? `${path}.${k}` : k;
        if (KEY_RE.test(k) && v != null && typeof v !== 'object' && String(v).trim()) {
          const hit = `${p} = ${String(v).slice(0, 80)}`;
          if (!seenPaths.has(hit)) { seenPaths.add(hit); careTeamProbe.scalarHits.push(hit); }
        }
        if (v && typeof v === 'object') scan(v, p, depth + 1);
      }
    };
    const sample = list.slice(0, 6);
    const dets = await mapLimit(sample, +(process.env.KIPU_CONCURRENCY || 4), async (p) => {
      const id = p.casefile_id ?? p.id ?? p.patient_id; return id ? kipuPatientDetail(String(id)).catch(() => null) : null;
    });
    for (const det of dets) { if (det) { careTeamProbe.sampled++; scan(det, '', 0); } }
  } catch (e) { careTeamProbe.error = String(e.message).slice(0, 140); }
  return { count: list.length, topKeys: Object.keys(data || {}), fields, facets, locations, admitTimeSamples, patientDetail, careTeamProbe, dischargeAnalysis, photoProbe, roundsProbe };
}

// One-time repair: a backfill sync stamped "today" as the discharge date for
// clients that had simply dropped off the active census. This re-pulls the
// date-ranged discharge feed, corrects each client's discharge_date (and the
// matching flow_event) to the REAL date, and re-rolls the affected daily
// metrics so the counts are honest. Safe to run repeatedly.
export async function kipuFixDischargeDates() {
  const phi = process.env.KIPU_PHI_LEVEL || 'high';
  const dDays = +(process.env.KIPU_DISCHARGE_DAYS || 90);
  const start = new Date(Date.now() - dDays * 864e5).toISOString().slice(0, 10);
  const locId = (process.env.KIPU_LOCATION_ID || '').trim();
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const nameOf = (p) => [pick(p, 'first_name'), pick(p, 'last_name')].filter(Boolean).join(' ').trim() || pick(p, 'name', 'full_name') || '';

  // 1) Date-ranged feed → real discharge dates, keyed by id, master id, AND name.
  let dpath = `/api/patients/census?phi_level=${phi}&start_date=${start}&end_date=${appToday()}`;
  if (locId) dpath += `&location_id=${encodeURIComponent(locId)}`;
  const dd = await kipuGet(dpath);
  const dlist = dd?.patients || dd?.census || (Array.isArray(dd) ? dd : []);
  const dateMap = new Map();
  const put = (key, d) => { if (key && d && !dateMap.has(key)) dateMap.set(key, d); };
  // Admit time-of-day, keyed the same ways, derived from created_at (local TZ).
  const admitMap = new Map();
  const putAT = (key, t) => { if (key && t && !admitMap.has(key)) admitMap.set(key, t); };
  const addAdmit = (p) => {
    const t = admitTimeFrom(pick(p, 'admission_date', 'admit_date', 'admitted_at'), pick(p, 'created_at', 'created_date'));
    if (!t) return;
    const kraw = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn');
    if (kraw) { const ks = String(kraw); putAT(ks, t); putAT(ks.split(':')[0], t); }
    putAT('name:' + norm(nameOf(p)), t);
  };
  for (const p of dlist) {
    addAdmit(p);
    const dRaw = pick(p, 'discharge_date', 'discharged_at'); if (!dRaw) continue;
    const d = String(dRaw).slice(0, 10);
    const kraw = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn');
    if (kraw) { const ks = String(kraw); put(ks, d); put(ks.split(':')[0], d); }
    put('name:' + norm(nameOf(p)), d);
  }

  // 2) Live active census → who is ACTUALLY still here (so we can un-discharge
  // anyone a prior sync wrongly swept off as "gone").
  let apath = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  if (locId && !/location_id=/.test(apath)) apath += (apath.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
  const activeIds = new Set(), activeNames = new Set();
  try {
    const ad = await kipuGet(apath);
    const alist = ad?.patients || ad?.census || (Array.isArray(ad) ? ad : []);
    for (const p of alist) {
      addAdmit(p);   // active rows carry created_at too
      const dRaw = pick(p, 'discharge_date', 'discharged_at'); if (dRaw && String(dRaw).trim()) continue;
      const k = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn');
      if (k) { const ks = String(k); activeIds.add(ks); activeIds.add(ks.split(':')[0]); }
      activeNames.add(norm(nameOf(p)));
    }
  } catch { /* if this fails we still do the date fix */ }

  const today = appToday();
  const clients = db.prepare(`SELECT id, name, pref, kipu_id, discharge_status, discharge_date, admit_time FROM clients WHERE source='kipu'`).all();
  const updC = db.prepare(`UPDATE clients SET discharge_date = ? WHERE id = ?`);
  const updE = db.prepare(`UPDATE flow_events SET date = ? WHERE client_id = ? AND kind IN ('discharge','ama')`);
  const updAT = db.prepare(`UPDATE clients SET admit_time = ? WHERE id = ?`);
  const reactivate = db.prepare(`UPDATE clients SET active = 1, discharge_status = NULL, discharge_date = NULL, discharge_reason = NULL, discharge_destination = NULL WHERE id = ?`);
  const delEvt = db.prepare(`DELETE FROM flow_events WHERE client_id = ? AND kind IN ('discharge','ama')`);
  const affected = new Set([today]);
  let fixed = 0, reactivated = 0, admitTimes = 0;
  db.exec('BEGIN');
  try {
    for (const c of clients) {
      const k = c.kipu_id ? String(c.kipu_id) : '';
      const km = k.split(':')[0];
      const nm = norm(c.name);
      // Backfill admit time-of-day (all clients) when it's blank.
      if (!(c.admit_time || '').trim()) {
        const at = admitMap.get(k) || admitMap.get(km) || admitMap.get('name:' + nm);
        if (at) { updAT.run(at, c.id); admitTimes++; }
      }
      if (!c.discharge_status) continue;   // the rest is discharge-only
      // Still active in Kipu → was wrongly discharged. Restore and drop the event.
      if ((k && activeIds.has(k)) || (km && activeIds.has(km)) || (nm && activeNames.has(nm))) {
        reactivate.run(c.id); delEvt.run(c.id); reactivated++;
        if (c.discharge_date) affected.add(String(c.discharge_date).slice(0, 10));
        continue;
      }
      const real = dateMap.get(k) || dateMap.get(km) || dateMap.get('name:' + nm);
      const cur = (c.discharge_date || '').slice(0, 10);
      if (real && real !== cur) { updC.run(real, c.id); updE.run(real, c.id); if (cur) affected.add(cur); affected.add(real); fixed++; }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  for (const d of affected) rollupDailyMetrics(d);
  return { checked: clients.length, fixed, reactivated, admitTimes, daysRerolled: affected.size };
}

// ── OUTPATIENT (separate location, e.g. "Akron House Recovery") ──────────────
// Read-only census for a SECOND Kipu location, kept completely apart from the detox
// roster — never writes to `clients`. Resolves the location by name, pulls its active
// census, and classifies each patient's level of care as PHP / IOP / OP / Other.
export async function kipuOutpatientCensus(locationName) {
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const want = String(locationName || '').trim().toLowerCase();
  if (!want) return { error: 'No outpatient location name configured.' };
  let locId = null, locName = null, locations = [];
  try {
    const loc = await kipuGet('/api/locations');
    const llist = loc?.locations || loc?.buildings || (Array.isArray(loc) ? loc : []);
    locations = llist.map((l) => ({ id: l.location_id ?? l.id ?? l.value, name: String(l.location_name ?? l.name ?? l.enabled_location_name ?? '') }));
    const hit = locations.find((l) => l.name.toLowerCase() === want) || locations.find((l) => l.name.toLowerCase().includes(want));
    if (hit) { locId = hit.id; locName = hit.name; }
  } catch (e) { return { error: 'Could not read Kipu locations: ' + e.message }; }
  if (locId == null) return { error: `Location "${locationName}" not found in Kipu.`, locations };
  let path = (process.env.KIPU_ROSTER_PATH || '/api/patients/census');
  path += (path.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  const classify = (lvl) => {
    const s = String(lvl || '').toLowerCase();
    if (/\bphp\b|partial hospital/.test(s)) return 'PHP';
    if (/\biop\b|intensive outpatient/.test(s)) return 'IOP';
    if (/\bop\b|outpatient/.test(s)) return 'OP';
    return 'Other';
  };
  // First pass: the active census rows (names/ids/admit). The census usually does NOT
  // carry level of care or insurance — those live on each patient's chart — so we
  // collect the basics here, then enrich from the per-patient detail below.
  const seen = new Set(); const basics = [];
  for (const p of list) {
    const kid = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn'); const ks = kid != null ? String(kid) : null;
    if (ks && seen.has(ks)) continue; if (ks) seen.add(ks);
    const dischDate = pick(p, 'discharge_date', 'discharged_at'); const dischStatus = pick(p, 'discharge_type', 'discharge_status');
    const discharged = Boolean((dischDate && String(dischDate).trim()) || (dischStatus && !['active', 'admitted', 'current'].includes(String(dischStatus).toLowerCase())));
    if (discharged) continue;
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name || '';
    if (!name) continue;
    const admitRaw = pick(p, 'admission_date', 'admit_date', 'admitted_at');
    basics.push({ p, ks, name, first: p.first_name || name, admit: admitRaw ? String(admitRaw).slice(0, 10) : '' });
  }
  // Second pass: pull each patient's detail to get level of care + insurance (the
  // census doesn't include them). Bounded concurrency, best-effort per patient.
  const enriched = await mapLimit(basics, +(process.env.KIPU_CONCURRENCY || 6), async (x) => {
    let det = null; try { det = x.ks ? await kipuPatientDetail(x.ks) : null; } catch { /* best-effort */ }
    return { ...x, det };
  });
  const patients = [];
  for (const x of enriched) {
    const g = (...keys) => { if (!x.det) return null; for (const k of keys) { const v = x.det[k]; if (v != null && String(v).trim() !== '') return Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v); } return null; };
    // `program` (e.g. "SA OP", "SA IOP 5", "SA PHP") is the patient's ACTUAL
    // current level of care. `level_of_care` is the UR-authorized level ("UR
    // LOC: IOP") which lags — OP patients have no authorization, so it stays at
    // the last authorized level and mislabels them as IOP. Prefer program; fall
    // back to the UR level only when program can't be classified.
    const program = pick(x.p, 'program', 'program_name', 'treatment_program')
      || g('program', 'program_name', 'treatment_program', 'census_program');
    const urloc = pick(x.p, 'level_of_care', 'levelOfCare', 'level_of_care_name', 'current_level_of_care', 'loc', 'level')
      || g('level_of_care', 'levelOfCare', 'level_of_care_name', 'current_level_of_care', 'loc', 'level');
    let cls = classify(program);
    if (cls === 'Other') cls = classify(urloc);
    const level = program || urloc;
    const payer = pick(x.p, 'insurance_company', 'insurance', 'payer', 'payor', 'insurance_name', 'primary_insurance')
      || g('insurance_company', 'insurance', 'payer', 'payor', 'insurance_name', 'primary_insurance', 'insurances');
    const therapist = pick(x.p, 'primary_therapist', 'therapist', 'counselor') || g('primary_therapist', 'therapist', 'counselor', 'clinician');
    patients.push({
      kipuId: x.ks, name: x.name, pref: x.first,
      level: level ? String(level) : '', loc_class: cls,
      admit: x.admit,
      mrn: String(pick(x.p, 'mr_number', 'mrn') || g('mr_number', 'mrn') || ''),
      therapist: String(therapist || ''),
      payer: String(payer || ''),
    });
  }
  const counts = { total: patients.length, PHP: 0, IOP: 0, OP: 0, Other: 0 };
  for (const p of patients) counts[p.loc_class] = (counts[p.loc_class] || 0) + 1;
  return { locationId: locId, locationName: locName, counts, patients };
}

// Discovery: find how THIS Kipu account exposes group sessions / attendance, so the
// outpatient group metrics can be wired to the real shape. Tries the likely endpoints
// and reports what responds (status, row count, sample keys). Read-only.
export async function kipuGroupProbe() {
  const tries = [
    '/api/groups', '/api/group_sessions', '/api/group_session_notes', '/api/groups/sessions',
    '/api/scheduler/groups', '/api/scheduler/appointments', '/api/care_levels', '/api/levels_of_care',
    '/api/patient_appointments', '/api/appointments',
  ];
  const out = [];
  for (const path of tries) {
    try {
      const d = await kipuGet(path);
      const arr = Array.isArray(d) ? d : (d?.groups || d?.group_sessions || d?.sessions || d?.appointments || d?.care_levels || Object.values(d || {}).find((v) => Array.isArray(v)) || []);
      out.push({ path, ok: true, count: Array.isArray(arr) ? arr.length : null, topKeys: Object.keys(d || {}).slice(0, 14), sampleKeys: (Array.isArray(arr) && arr[0] && typeof arr[0] === 'object') ? Object.keys(arr[0]).slice(0, 24) : [] });
    } catch (e) { out.push({ path, ok: false, error: String(e.message).slice(0, 140) }); }
  }
  return { probes: out };
}

// Discovery: find how this Kipu account exposes utilization-review / authorization
// HISTORY, so PHP→IOP step-down dates can be reconstructed for past stays. UR is
// usually charted per casefile, so we grab a couple of real casefile ids first and
// probe both account-level and per-patient endpoints. For anything that responds we
// deep-scan for level + date fields that look like authorization periods. Read-only.
export async function kipuUrProbe(locationName) {
  const pick = (p, ...keys) => { for (const k of keys) { if (p && p[k] != null && p[k] !== '') return p[k]; } return null; };
  // Resolve location + a few sample casefile ids from the census.
  let locId = null;
  const samples = [];
  try {
    const want = String(locationName || '').trim().toLowerCase();
    const loc = await kipuGet('/api/locations');
    const llist = loc?.locations || loc?.buildings || (Array.isArray(loc) ? loc : []);
    const ls = llist.map((l) => ({ id: l.location_id ?? l.id ?? l.value, name: String(l.location_name ?? l.name ?? l.enabled_location_name ?? '') }));
    const hit = ls.find((l) => l.name.toLowerCase() === want) || ls.find((l) => l.name.toLowerCase().includes(want));
    if (hit) locId = hit.id;
    let path = (process.env.KIPU_ROSTER_PATH || '/api/patients/census');
    if (locId != null) path += (path.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
    const data = await kipuGet(path);
    const list = (data?.patients || data?.census || (Array.isArray(data) ? data : [])).slice(0, 4);
    for (const p of list) {
      const cf = String(pick(p, 'casefile_id', 'id', 'patient_id') || '');
      if (cf) samples.push({ cf, name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || cf });
    }
  } catch (e) { return { error: 'setup: ' + e.message }; }
  if (!samples.length) return { error: 'No sample patients found to probe UR endpoints against.' };
  const cf = samples[0].cf;
  // The casefile id is composite: "<integerPatientId>:<patient_master_uuid>". Kipu's
  // per-patient routes want the INTEGER id in the path plus phi_level + patient_master_id
  // as query params (passing the composite string is what made the real routes 500).
  const phi = process.env.KIPU_PHI_LEVEL || 'high';
  const master = cf.split(':')[0];
  const uuid = cf.includes(':') ? cf.slice(cf.indexOf(':') + 1) : cf;
  const q = `?phi_level=${phi}&patient_master_id=${encodeURIComponent(uuid)}`;
  const pp = (sub) => `/api/patients/${master}/${sub}${q}`;
  // Account-level + per-patient endpoint candidates for UR / authorizations / level history.
  const tries = [
    '/api/utilization_reviews', '/api/ur_reviews', '/api/urs', '/api/ur',
    '/api/authorizations', '/api/insurance_authorizations', '/api/patient_authorizations',
    '/api/care_levels', '/api/level_of_care_changes', '/api/level_changes',
    pp('utilization_reviews'), pp('ur'), pp('urs'),
    pp('authorizations'), pp('insurance_authorizations'),
    pp('care_levels'), pp('levels_of_care'), pp('level_of_care'),
    pp('level_changes'), pp('program_history'), pp('admissions'),
    `/api/patients/${master}${q}`,
  ];
  // Pull the level/date-ish fields out of any object, recursively, so we can see if
  // an authorization period (start/end + level) actually lives in the payload.
  const interesting = (k) => /level|loc|\bur\b|authoriz|\bauth|care|program|partial|intensive|outpat|\bphp\b|\biop\b|\bop\b|step|begin|start|end|expir|through|effective|from|to|admit|discharge|date|period|review/i.test(k);
  const dig = (obj, depth, prefix, bag) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (typeof v === 'object') { if (Array.isArray(v)) v.slice(0, 3).forEach((it, i) => dig(it, depth + 1, `${prefix}${k}[${i}].`, bag)); else dig(v, depth + 1, `${prefix}${k}.`, bag); }
      else if (interesting(k)) bag[prefix + k] = String(v).slice(0, 80);
    }
  };
  const out = [];
  for (const path of tries) {
    try {
      const d = await kipuGet(path);
      const arr = Array.isArray(d) ? d : (Object.values(d || {}).find((v) => Array.isArray(v)) || null);
      const first = arr && arr[0] && typeof arr[0] === 'object' ? arr[0] : (d && typeof d === 'object' ? d : null);
      const bag = {}; dig(first, 0, '', bag);
      out.push({ path, ok: true, count: Array.isArray(arr) ? arr.length : null, topKeys: Object.keys(d || {}).slice(0, 16), fields: bag });
    } catch (e) { out.push({ path, ok: false, error: String(e.message).slice(0, 120) }); }
  }
  return { sampleCasefile: cf, sampleName: samples[0].name, probes: out };
}

// Group attendance via /api/group_sessions (the endpoint that actually exists on
// this account — it carries session_start_time + a `patients` attendee list).
// Returns, for the given date window, who attended at least one group each day and
// the per-patient session count, keyed by casefile id so the app can match it to
// the enrolled roster. `sample` exposes the raw attendee shape for verification.
export async function kipuGroupAttendance(locationName, startDate, endDate) {
  const pick = (p, ...keys) => { for (const k of keys) { if (p && p[k] != null && p[k] !== '') return p[k]; } return null; };
  const want = String(locationName || '').trim().toLowerCase();
  if (!want) return { error: 'No outpatient location name configured.' };
  let locId = null, locName = null;
  try {
    const loc = await kipuGet('/api/locations');
    const llist = loc?.locations || loc?.buildings || (Array.isArray(loc) ? loc : []);
    const ls = llist.map((l) => ({ id: l.location_id ?? l.id ?? l.value, name: String(l.location_name ?? l.name ?? l.enabled_location_name ?? '') }));
    const hit = ls.find((l) => l.name.toLowerCase() === want) || ls.find((l) => l.name.toLowerCase().includes(want));
    if (hit) { locId = hit.id; locName = hit.name; }
  } catch (e) { return { error: 'Could not read Kipu locations: ' + e.message }; }
  if (locId == null) return { error: `Location "${locationName}" not found in Kipu.` };
  const sd = String(startDate || '').slice(0, 10);
  const ed = String(endDate || startDate || '').slice(0, 10);
  // Pull all group sessions in the window (paginated). Kipu accepts start_date/end_date.
  const sessions = [];
  for (let page = 1; page <= 20; page++) {
    let path = '/api/group_sessions?page=' + page + '&per=100';
    if (sd) path += '&start_date=' + encodeURIComponent(sd);
    if (ed) path += '&end_date=' + encodeURIComponent(ed);
    let d; try { d = await kipuGet(path); } catch (e) { if (page === 1) return { error: 'group_sessions: ' + e.message }; break; }
    const arr = d?.group_sessions || d?.sessions || (Array.isArray(d) ? d : Object.values(d || {}).find((v) => Array.isArray(v)) || []);
    if (!Array.isArray(arr) || arr.length === 0) break;
    sessions.push(...arr);
    if (arr.length < 100) break;
  }
  const dayOf = (raw) => localDateOf(raw) || (raw ? String(raw).slice(0, 10) : '');
  const attendedFlag = (pt) => {
    const v = pick(pt, 'attended', 'present', 'attendance', 'status', 'attendance_status', 'patient_attended');
    if (v == null) return null;                       // unknown → treat as enrolled-only
    const s = String(v).toLowerCase();
    if (/present|attended|yes|true|complete|show/.test(s)) return true;
    if (/no.?show|absent|no|false|cancel|excused/.test(s)) return false;
    return v === true ? true : (v === false ? false : null);
  };
  // per casefile id, per day: { enrolled:Set<sessionId>, attended:Set<sessionId> }
  const byPatient = new Map();
  let sample = null, considered = 0;
  for (const s of sessions) {
    if (locId != null && s.location_id != null && String(s.location_id) !== String(locId)) continue;
    const day = dayOf(pick(s, 'session_start_time', 'start_time', 'session_date', 'date'));
    if (sd && day && (day < sd || day > ed)) continue;
    considered++;
    const sid = String(pick(s, 'id', 'gs_group_session_id', 'group_session_id') || considered);
    const pts = s.patients || s.attendees || s.patient_attendances || [];
    if (!sample && Array.isArray(pts) && pts[0] && typeof pts[0] === 'object') sample = { sessionKeys: Object.keys(s).slice(0, 24), patientKeys: Object.keys(pts[0]).slice(0, 24), patientExample: pts[0] };
    for (const pt of (Array.isArray(pts) ? pts : [])) {
      const kid = String(pick(pt, 'casefile_id', 'patient_id', 'id', 'mr_number', 'mrn') || '');
      if (!kid) continue;
      const rec = byPatient.get(kid) || { name: String(pick(pt, 'name', 'patient_name', 'full_name') || ''), enrolled: new Set(), attended: new Set() };
      rec.enrolled.add(sid);
      const f = attendedFlag(pt);
      if (f === true) rec.attended.add(sid);
      byPatient.set(kid, rec);
    }
  }
  const patients = {};
  for (const [kid, rec] of byPatient) patients[kid] = { name: rec.name, enrolled: rec.enrolled.size, attended: rec.attended.size };
  return { locationId: locId, locationName: locName, start: sd, end: ed, sessionsPulled: sessions.length, sessionsConsidered: considered, patients, sample };
}

// Field discovery for outpatient: dump the level / UR / authorization / care fields
// from a few patients' charts, so we can find (a) the ACTUAL current level (to split
// OP from IOP — UR LOC is the authorized level, which lags) and (b) the PHP
// authorization period (PHP auth end ≈ step-down to IOP) to compute PHP LOS.
export async function kipuOutpatientFieldInspect(locationName, sampleN = 6) {
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const want = String(locationName || '').trim().toLowerCase();
  let locId = null;
  try {
    const loc = await kipuGet('/api/locations');
    const llist = loc?.locations || loc?.buildings || (Array.isArray(loc) ? loc : []);
    const ls = llist.map((l) => ({ id: l.location_id ?? l.id ?? l.value, name: String(l.location_name ?? l.name ?? l.enabled_location_name ?? '') }));
    const hit = ls.find((l) => l.name.toLowerCase() === want) || ls.find((l) => l.name.toLowerCase().includes(want));
    if (hit) locId = hit.id;
  } catch (e) { return { error: 'locations: ' + e.message }; }
  if (locId == null) return { error: `Location "${locationName}" not found.` };
  let path = (process.env.KIPU_ROSTER_PATH || '/api/patients/census');
  path += (path.includes('?') ? '&' : '?') + 'location_id=' + encodeURIComponent(locId);
  const data = await kipuGet(path);
  const list = (data?.patients || data?.census || (Array.isArray(data) ? data : [])).slice(0, sampleN * 2);
  const interesting = (k) => /level|loc|\bur\b|authoriz|\bauth|program|care|partial|intensive|outpat|\bphp\b|\biop\b|\bop\b|step|frequenc|session|begin|start|end|expir|through|admit|discharge|date/i.test(k);
  const flat = {};
  const scan = (obj, depth, prefix) => {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (typeof v === 'object') {
        if (Array.isArray(v)) { if (interesting(k) || /authoriz|\bur\b|level|care/i.test(k)) { (v.slice(0, 2)).forEach((it, i) => scan(it, depth + 1, `${prefix}${k}[${i}].`)); } }
        else scan(v, depth + 1, `${prefix}${k}.`);
      } else if (interesting(k)) { flat[prefix + k] = String(v).slice(0, 90); }
    }
  };
  const out = [];
  for (const p of list.slice(0, sampleN)) {
    const ks = String(pick(p, 'casefile_id', 'id', 'patient_id', 'mrn') || '');
    let det = null; try { det = ks ? await kipuPatientDetail(ks) : null; } catch { /* best-effort */ }
    Object.keys(flat).forEach((k) => delete flat[k]);
    scan(p, 0, 'census.'); scan(det, 0, '');
    out.push({ name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || ks, fields: { ...flat } });
  }
  return { sample: out };
}

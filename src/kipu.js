// Kipu EMR connector. Kipu signs requests with the APIAuth (HMAC-SHA1) scheme.
// Credentials come from the environment (set them on your HIPAA host — never commit):
//   KIPU_ACCESS_ID, KIPU_SECRET_KEY, KIPU_APP_ID (a.k.a. recipient/location id),
//   KIPU_BASE_URL (default https://api.kipuapi.com)
// NOTE: the exact canonical string + roster endpoint can vary by Kipu API
// version; this implements the documented v3 pattern and is verified on first
// connect via /api/kipu/test before any sync.
import crypto from 'node:crypto';
import { db } from './db.js';

export function kipuConfigured() {
  return Boolean(process.env.KIPU_ACCESS_ID && process.env.KIPU_SECRET_KEY && process.env.KIPU_APP_ID);
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

// Quick connectivity check.
export async function kipuTest() {
  const path = process.env.KIPU_TEST_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const n = Array.isArray(data?.patients) ? data.patients.length : (Array.isArray(data) ? data.length : null);
  return { ok: true, sampleCount: n };
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
  const byKipu = db.prepare(`SELECT id FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, admit, admit_time, therapist, case_manager, kipu_id, source, active) VALUES (?,?,?,?,?,?,?,?,?, 'kipu', 1)`);

  // Pull a field from the many shapes Kipu can return.
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const timeOf = (v) => { if (!v) return null; const m = String(v).match(/[T ](\d{2}:\d{2})/); return m ? m[1] : null; };
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

  for (const p of list) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
    if (!name) continue;
    if (!matchesLoc(p)) continue;
    const kid = pick(p, 'id', 'casefile_id', 'patient_id', 'mrn') && String(pick(p, 'id', 'casefile_id', 'patient_id', 'mrn'));
    const admitRaw = pick(p, 'admission_date', 'admit_date', 'admitted_at');
    const admit = admitRaw ? String(admitRaw).slice(0, 10) : null;
    const admitTime = timeOf(admitRaw);
    const therapist = pick(p, 'primary_therapist', 'therapist', 'counselor');
    const caseMgr = pick(p, 'case_manager', 'casemanager');
    const room = pick(p, 'bed_name', 'room', 'bed');
    const program = pick(p, 'level_of_care', 'program', 'loc');
    const dischStatus = pick(p, 'discharge_type', 'discharge_status');
    const dischDate = pick(p, 'discharge_date', 'discharged_at');
    const dischDest = pick(p, 'discharge_destination', 'referred_to', 'aftercare_facility');
    const dischReason = pick(p, 'discharge_reason', 'discharge_note');
    const discharged = Boolean((dischDate && String(dischDate).trim()) ||
      (dischStatus && !['active', 'admitted', 'current'].includes(String(dischStatus).toLowerCase())));
    if (!discharged && kid) activeKids.push(kid);

    const existing = (kid && byKipu.get(kid)) || byName.get(name, name);
    if (existing) {
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
        discharge_status = ?, discharge_date = ?,
        discharge_destination = COALESCE(NULLIF(discharge_destination,''), ?),
        discharge_reason = COALESCE(NULLIF(discharge_reason,''), ?),
        active = ?
        WHERE id = ?`).run(kid || null, admit, admitTime, therapist, caseMgr, room, program,
          discharged ? (dischStatus ? String(dischStatus) : 'Discharged') : null,
          discharged ? (dischDate ? String(dischDate).slice(0, 10) : null) : null,
          dischDest, dischReason, discharged ? 0 : 1, existing.id);
      matched++;
    } else if (!discharged) {
      // Only create rows for currently-active patients.
      ins.run(name, p.first_name || name, room, program, admit, admitTime, therapist, caseMgr, kid || null);
      created++;
    }
  }

  // Authoritative roster: any Kipu-sourced client NOT in the current active
  // census is no longer here — deactivate it (discharged/transferred elsewhere).
  let deactivated = 0;
  if (activeKids.length) {
    const ph = activeKids.map(() => '?').join(',');
    const r = db.prepare(`UPDATE clients SET active = 0 WHERE source='kipu' AND active = 1 AND (kipu_id IS NULL OR kipu_id NOT IN (${ph}))`).run(...activeKids);
    deactivated = r.changes || 0;
  }
  return { total: list.length, created, matched, deactivated, activeNow: activeKids.length };
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
  const tmpl = process.env.KIPU_NOTES_PATH || '/api/patient_evaluations?patient_id={id}';
  const data = await kipuGet(tmpl.replace('{id}', casefileId));
  let list = data?.patient_evaluations || data?.evaluations || (Array.isArray(data) ? data : []);
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))); // newest first
  const max = +(process.env.KIPU_NOTES_MAX || 16);
  const texts = [];
  for (const e of list.slice(0, max)) {
    const nm = (e.name || 'Note').trim();
    const date = String(e.created_at || '').slice(0, 10);
    let content = '';
    if (e.id) {
      try {
        const d = await kipuGet(`/api/patient_evaluations/${e.id}?patient_id=${casefileId}`);
        const ev = d?.patient_evaluation || d?.evaluation || d;
        // Prefer the answered items; fall back to the whole evaluation object.
        content = extractItems(ev?.patient_evaluation_items || ev?.evaluation_items || ev?.items) || extractText(ev?.evaluation_content);
        if (!content) content = extractText(ev);
      } catch { /* skip this note */ }
    }
    content = (content || '').replace(/^\s*standard\s*$/i, '').trim();
    if (content && content.length > 12) texts.push(`[${date} · ${nm}]\n${content}`);
  }
  return texts.join('\n\n').slice(0, 18000); // keep the prompt bounded
}

// Pull label: value pairs out of Kipu evaluation items (only answered fields).
function extractItems(items) {
  if (!Array.isArray(items)) return '';
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const label = it.label || it.name || it.field_name || it.question || '';
    const val = it.value ?? it.answer ?? it.description ?? it.note ?? it.text ?? it.string_value ?? it.records;
    const v = extractText(val);
    if (v && v.length > 1) out.push(label ? `${stripHtml(String(label))}: ${v}` : v);
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
  return { count: list.length, topKeys: Object.keys(data || {}), fields, facets, locations };
}

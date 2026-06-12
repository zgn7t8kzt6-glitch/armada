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
  const byKipu = db.prepare(`SELECT id, loc, active FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id, loc, active FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, loc, admit, admit_time, therapist, case_manager, kipu_id, source, active) VALUES (?,?,?,?,?,?,?,?,?,?, 'kipu', 1)`);
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

  for (const p of list) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
    if (!name) continue;
    if (!matchesLoc(p)) continue;
    const kid = pick(p, 'casefile_id', 'id', 'patient_id', 'mrn') && String(pick(p, 'casefile_id', 'id', 'patient_id', 'mrn'));
    const admitRaw = pick(p, 'admission_date', 'admit_date', 'admitted_at');
    const admit = admitRaw ? String(admitRaw).slice(0, 10) : null;
    if (admitCutoff && admit && admit < admitCutoff) continue;   // opt-in recency filter
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

    const newLoc = realLoc(program);
    const existing = (kid && byKipu.get(kid)) || byName.get(name, name);
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
      const info = ins.run(name, p.first_name || name, room, program, newLoc, admit, admitTime, therapist, caseMgr, kid || null);
      // Record an admission event only for genuinely new intakes (admitted today
      // or yesterday) — never for the initial baseline import of the standing
      // census, which would inflate past days with a one-time spike.
      if (admit && admit >= yest) evt.run(info.lastInsertRowid, kid || null, 'admit', null, newLoc, admit, null);
      created++;
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
  const base = tmpl.replace('{id}', casefileId);
  const first = await kipuGet(base);
  let list = first?.patient_evaluations || first?.evaluations || (Array.isArray(first) ? first : []);
  // Kipu paginates a re-admit's evaluations OLDEST-first, so the current stay's
  // notes are on the LAST page(s). Pull those too, then dedupe.
  const pag = first?.pagination || {};
  const per = +(pag.per_page || pag.records_per_page || pag.per || 100) || 100;
  const totalRecords = +(pag.total_records || pag.total_count || pag.total || pag.count || 0) || 0;
  let totalPages = +(pag.total_pages || pag.total_page || pag.last_page || pag.pages || pag.page_count || 0) || 0;
  if (!totalPages && totalRecords) totalPages = Math.ceil(totalRecords / per);
  if (!totalPages) totalPages = list.length >= per ? 2 : 1;   // assume more if page is full
  for (const pg of [totalPages, totalPages - 1, totalPages - 2]) {
    if (pg > 1) {
      try { const d = await kipuGet(base + (base.includes('?') ? '&' : '?') + 'page=' + pg);
        list = list.concat(d?.patient_evaluations || d?.evaluations || []); } catch { /* ignore */ }
    }
  }
  const seen = new Set();
  list = list.filter((e) => { const k = e.id ?? e.evaluation_id; if (k == null || seen.has(k)) return false; seen.add(k); return true; });
  // ANTI-CONTAMINATION: every evaluation carries patient_casefile_id — keep ONLY
  // notes that belong to this exact patient (paginated pages can otherwise leak
  // other patients' notes).
  const want_cf = String(casefileId);
  const want_pref = want_cf.split(':')[0];
  list = list.filter((e) => {
    const cf = e.patient_casefile_id ?? e.casefile_id ?? e.patient_id;
    if (cf == null || cf === '') return true;            // keep if the note doesn't say
    const s = String(cf);
    return s === want_cf || s.split(':')[0] === want_pref;
  });
  // CURRENT STAY ONLY: keep notes from the recent window (default 90 days) so a
  // re-admit's old chart never leaks in. Configurable via KIPU_NOTE_DAYS.
  const noteDays = +(process.env.KIPU_NOTE_DAYS || 30);
  const noteCutoff = new Date(Date.now() - noteDays * 864e5).toISOString().slice(0, 10);
  list = list.filter((e) => String(e.created_at || '').slice(0, 10) >= noteCutoff);
  // Narrative notes first (real free-text), then newest-first.
  const narrative = (nm) => /progress|nursing|group|case ?manage|family session|counsel|physician|clinical note|shift|encounter|\bbht\b/i.test(nm || '');
  list.sort((a, b) => {
    const an = narrative(a.name), bn = narrative(b.name);
    if (an !== bn) return an ? -1 : 1;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  const want = +(process.env.KIPU_NOTES_MAX || 12);
  let budget = 30;                 // bound detail fetches per patient
  const texts = [];
  for (const e of list) {
    if (texts.length >= want || budget <= 0) break;
    if (!e.id) continue;
    budget--;
    let content = '';
    try {
      const d = await kipuGet(`/api/patient_evaluations/${e.id}?patient_id=${casefileId}`);
      const ev = d?.patient_evaluation || d?.evaluation || d;
      const items = extractItems(ev);                                    // finds the items array wherever it lives
      const body = extractText(ev?.evaluation_content);                  // the rendered note paragraph
      const bodyClean = body && !/^standard$/i.test(body.trim()) ? body : '';
      content = [bodyClean, items].filter(Boolean).join('\n').trim();    // narrative first, then answered fields
      // (no raw-structure fallback — empty is better than dumping metadata)
    } catch { /* skip this note */ }
    if (content && content.length > 10) texts.push(`[${String(e.created_at || '').slice(0, 10)} · ${(e.name || 'Note').trim()}]\n${content}`);
  }
  return texts.join('\n\n').slice(0, 18000); // keep the prompt bounded
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
  return { count: list.length, topKeys: Object.keys(data || {}), fields, facets, locations };
}

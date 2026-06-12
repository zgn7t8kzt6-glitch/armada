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
  const path = process.env.KIPU_ROSTER_PATH || '/api/patients/census';
  const data = await kipuGet(path);
  const list = data?.patients || data?.census || (Array.isArray(data) ? data : []);
  let created = 0, matched = 0, updated = 0;
  const byKipu = db.prepare(`SELECT id FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, admit, admit_time, therapist, case_manager, kipu_id) VALUES (?,?,?,?,?,?,?,?,?)`);

  // Pull a field from the many shapes Kipu can return.
  const pick = (p, ...keys) => { for (const k of keys) { if (p[k] != null && p[k] !== '') return p[k]; } return null; };
  const timeOf = (v) => { if (!v) return null; const m = String(v).match(/[T ](\d{2}:\d{2})/); return m ? m[1] : null; };

  for (const p of list) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || p.full_name;
    if (!name) continue;
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

    let existing = (kid && byKipu.get(kid)) || byName.get(name, name);
    if (existing) {
      // Backfill only blank fields (never overwrite staff edits).
      db.prepare(`UPDATE clients SET
        kipu_id = COALESCE(kipu_id, ?),
        admit = COALESCE(NULLIF(admit,''), ?),
        admit_time = COALESCE(NULLIF(admit_time,''), ?),
        therapist = COALESCE(NULLIF(therapist,''), ?),
        case_manager = COALESCE(NULLIF(case_manager,''), ?),
        room = COALESCE(NULLIF(room,''), ?),
        program = COALESCE(NULLIF(program,''), ?),
        discharge_status = COALESCE(NULLIF(discharge_status,''), ?),
        discharge_date = COALESCE(NULLIF(discharge_date,''), ?),
        discharge_destination = COALESCE(NULLIF(discharge_destination,''), ?),
        discharge_reason = COALESCE(NULLIF(discharge_reason,''), ?)
        WHERE id = ?`).run(kid || null, admit, admitTime, therapist, caseMgr, room, program,
          dischStatus, dischDate ? String(dischDate).slice(0, 10) : null, dischDest, dischReason, existing.id);
      matched++; updated++;
    } else {
      ins.run(name, p.first_name || name, room, program, admit, admitTime, therapist, caseMgr, kid || null);
      created++;
    }
  }
  return { total: list.length, created, matched, updated };
}

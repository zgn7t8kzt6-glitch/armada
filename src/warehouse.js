// Azure SQL "data warehouse" connector — reads Chaim's existing Kipu warehouse
// (the dashboard's ADF-refreshed copy: kipu.*, dim.*, fact.*) instead of hitting
// the Kipu API directly. Richer + already cleaned (census, LOS, discharges, notes).
//
// Set on the host (never commit). Use a DEDICATED READ-ONLY login:
//   WH_SERVER     e.g. armada-sql.database.windows.net
//   WH_DATABASE   e.g. Armada
//   WH_USER       e.g. armada_app   (SELECT-only)
//   WH_PASSWORD   ...
// Optional: WH_PORT (1433), WH_TRUST_CERT (true to skip cert validation),
//   WH_CENSUS_SQL (the roster query — defaults to SELECT * FROM kipu.census),
//   WH_NOTES_SQL  (recent clinical notes for red-flag scanning).
//
// Inert until configured; the app's own data works without it.
import sql from 'mssql';

let _pool = null;

export function whConfigured() {
  return Boolean(process.env.WH_SERVER && process.env.WH_DATABASE && process.env.WH_USER && process.env.WH_PASSWORD);
}

async function pool() {
  if (!whConfigured()) throw new Error('Warehouse not configured. Set WH_SERVER, WH_DATABASE, WH_USER, WH_PASSWORD.');
  if (_pool && _pool.connected) return _pool;
  if (_pool) { try { await _pool.close(); } catch {} _pool = null; }
  _pool = await new sql.ConnectionPool({
    server: process.env.WH_SERVER,
    database: process.env.WH_DATABASE,
    user: process.env.WH_USER,
    password: process.env.WH_PASSWORD,
    port: +(process.env.WH_PORT || 1433),
    options: { encrypt: true, trustServerCertificate: process.env.WH_TRUST_CERT === 'true' },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 20000, requestTimeout: 90000,
  }).connect();
  return _pool;
}

async function query(q) {
  const p = await pool();
  const r = await p.request().query(q);
  return r.recordset || [];
}

// Connectivity / auth / firewall check used by Settings before any sync.
export async function whTest() {
  await query('SELECT 1 AS ok');
  // If a census query is configured, also report how many rows it returns.
  let sampleCount = null;
  if (process.env.WH_CENSUS_SQL || true) {
    try {
      const census = process.env.WH_CENSUS_SQL || 'SELECT * FROM kipu.census';
      const rows = await query(`SELECT COUNT(*) AS n FROM (${census.replace(/;\s*$/, '')}) AS _c`);
      sampleCount = rows[0]?.n ?? null;
    } catch { /* census table/view may differ; connectivity already confirmed */ }
  }
  return { ok: true, sampleCount };
}

// Pull the warehouse census and upsert into clients. Idempotent on the external
// id; only backfills BLANK fields so it never clobbers staff edits. Maps the
// analytics fields (admit time, therapist, discharge where/why) when present.
export async function whSyncRoster(db) {
  const censusSql = process.env.WH_CENSUS_SQL || 'SELECT * FROM kipu.census';
  const rows = await query(censusSql);
  const pick = (r, ...keys) => { for (const k of keys) { for (const kk of [k, k.toLowerCase(), k.toUpperCase()]) { if (r[kk] != null && r[kk] !== '') return r[kk]; } } return null; };
  const dstr = (v) => v == null ? null : String(v instanceof Date ? v.toISOString() : v);
  const dateOnly = (v) => { const s = dstr(v); return s ? s.slice(0, 10) : null; };
  const timeOf = (v) => { const s = dstr(v); if (!s) return null; const m = s.match(/[T ](\d{2}:\d{2})/); return m ? m[1] : null; };

  const byKipu = db.prepare(`SELECT id FROM clients WHERE kipu_id = ?`);
  const byName = db.prepare(`SELECT id FROM clients WHERE name = ? OR pref = ?`);
  const ins = db.prepare(`INSERT INTO clients (name, pref, room, program, admit, admit_time, therapist, case_manager, kipu_id) VALUES (?,?,?,?,?,?,?,?,?)`);
  let created = 0, matched = 0;

  for (const r of rows) {
    const first = pick(r, 'first_name', 'firstname', 'patient_first_name');
    const last = pick(r, 'last_name', 'lastname', 'patient_last_name');
    const name = [first, last].filter(Boolean).join(' ').trim() || pick(r, 'patient_name', 'full_name', 'name');
    if (!name) continue;
    const kid = pick(r, 'casefile_id', 'patient_id', 'mrn', 'kipu_id', 'id');
    const kidStr = kid != null ? String(kid) : null;
    const admitRaw = pick(r, 'admission_date', 'admit_date', 'admitted_at', 'admit_datetime');
    const room = pick(r, 'bed_name', 'bed', 'room', 'location');
    const program = pick(r, 'level_of_care', 'loc', 'program');
    const therapist = pick(r, 'primary_therapist', 'therapist', 'counselor');
    const caseMgr = pick(r, 'case_manager', 'casemanager');
    const dStatus = pick(r, 'discharge_type', 'discharge_status');
    const dDate = pick(r, 'discharge_date', 'discharged_at');
    const dDest = pick(r, 'discharge_destination', 'referred_to', 'aftercare_facility');
    const dReason = pick(r, 'discharge_reason');

    const existing = (kidStr && byKipu.get(kidStr)) || byName.get(name, name);
    if (existing) {
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
        WHERE id = ?`).run(
        kidStr, dateOnly(admitRaw), timeOf(admitRaw), therapist, caseMgr,
        room != null ? String(room) : null, program != null ? String(program) : null,
        dStatus != null ? String(dStatus) : null, dateOnly(dDate),
        dDest != null ? String(dDest) : null, dReason != null ? String(dReason) : null, existing.id);
      matched++;
    } else {
      ins.run(name, first || name, room != null ? String(room) : null,
        program != null ? String(program) : null, dateOnly(admitRaw), timeOf(admitRaw),
        therapist, caseMgr, kidStr);
      created++;
    }
  }
  return { total: rows.length, created, matched };
}

// Pull recent clinical notes and run them through the red-flag scanner, raising
// dashboard alerts for unhappy/at-risk signals. Configurable to the warehouse's
// note table (default progress notes from patient_evaluation_records).
export async function whSyncNotes(db, scanNote, opts = {}) {
  const days = +(opts.days || 3);
  const notesSql = process.env.WH_NOTES_SQL ||
    `SELECT casefile_id, evaluation_name, progress_note, created_at
     FROM kipu.patient_evaluation_records
     WHERE progress_note IS NOT NULL AND created_at >= DATEADD(day, -${days}, GETDATE())`;
  const rows = await query(notesSql);
  const pick = (r, ...keys) => { for (const k of keys) { if (r[k] != null && r[k] !== '') return r[k]; } return null; };
  const findClient = db.prepare(`SELECT id FROM clients WHERE kipu_id = ?`);
  let scanned = 0, flagged = 0, skipped = 0;
  for (const r of rows) {
    const text = pick(r, 'progress_note', 'note', 'body');
    if (!text || String(text).trim().length < 10) { skipped++; continue; }
    const kid = pick(r, 'casefile_id', 'patient_id', 'mrn');
    const client = kid != null ? findClient.get(String(kid)) : null;
    try {
      const res = await scanNote(String(text));
      scanned++;
      if (res?.flagged) {
        flagged++;
        db.prepare(`INSERT INTO notes (client_id, text, source, author, flagged, flag_level, flag_summary, suggested_action)
          VALUES (?,?,?,?,?,?,?,?)`).run(client?.id || null, String(text).slice(0, 4000), 'Kipu warehouse',
          pick(r, 'evaluation_name', 'author') || 'EMR', 1, res.level || null, res.summary || null, res.suggested_action || null);
      }
    } catch { /* skip a single bad note, keep going */ }
  }
  return { total: rows.length, scanned, flagged, skipped };
}

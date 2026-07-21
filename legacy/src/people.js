/* One person, one journey — the identity layer that links the same human
   across the three program worlds:
     clients             (detox / residential)
     outpatient_clients  (PHP / IOP)
     housing_residents   (sober living)

   Matching is deliberately conservative: normalized full name + DOB when both
   sides have one; a bare name only links when it is unambiguous. Ambiguity
   leaves a row unlinked — a wrong link is worse than a missing one, and the
   hourly sweep re-tries as data (like a DOB) fills in. */
import { db } from './db.js';

export function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')          // "(pref)" annotations
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function mountPeople() {
  db.exec(`CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    dob TEXT, phone TEXT, email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_people_key ON people(name_key)`); } catch { /* optional */ }
  for (const t of ['clients', 'outpatient_clients', 'housing_residents']) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN person_id INTEGER`); } catch { /* exists */ }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_person ON ${t}(person_id)`); } catch { /* optional */ }
  }
}

/* Link every unlinked roster row to a person (creating people as needed).
   Idempotent and cheap enough to run at boot, hourly, and lazily on demand. */
export function linkPeople() {
  const stats = { linked: 0, created: 0, ambiguous: 0 };
  const byKey = new Map();
  for (const p of db.prepare(`SELECT id, name, name_key, dob FROM people`).all()) {
    const a = byKey.get(p.name_key) || []; a.push(p); byKey.set(p.name_key, a);
  }
  const insertP = db.prepare(`INSERT INTO people (name, name_key, dob, phone, email) VALUES (?,?,?,?,?)`);
  const fillDob = db.prepare(`UPDATE people SET dob = ?, updated_at = datetime('now') WHERE id = ?`);
  const resolve = (name, dob, phone, email) => {
    const key = normName(name);
    if (!key || key.split(' ').length < 2) return null;   // need first + last
    dob = (dob || '').slice(0, 10) || null;
    const cands = byKey.get(key) || [];
    if (dob) {
      const exact = cands.find((p) => p.dob === dob);
      if (exact) return exact.id;
      const blank = cands.filter((p) => !p.dob);
      if (blank.length === 1) { fillDob.run(dob, blank[0].id); blank[0].dob = dob; return blank[0].id; }
      // same name, different known DOB → genuinely a different person: create.
    } else {
      if (cands.length === 1) return cands[0].id;
      if (cands.length > 1) { stats.ambiguous++; return null; }
    }
    const id = Number(insertP.run(name, key, dob, phone || null, email || null).lastInsertRowid);
    const rec = { id, name, name_key: key, dob };
    const a = byKey.get(key) || []; a.push(rec); byKey.set(key, a);
    stats.created++;
    return id;
  };
  const worlds = [
    { table: 'clients', dob: 'dob' },
    { table: 'outpatient_clients', dob: null },
    { table: 'housing_residents', dob: 'dob', phone: 'phone', email: 'email' },
  ];
  for (const w of worlds) {
    let rows = [];
    try { rows = db.prepare(`SELECT rowid AS _rid, * FROM ${w.table} WHERE person_id IS NULL`).all(); } catch { continue; }
    if (!rows.length) continue;
    const upd = db.prepare(`UPDATE ${w.table} SET person_id = ? WHERE rowid = ?`);
    for (const r of rows) {
      const pid = resolve(r.name, w.dob ? r[w.dob] : null, w.phone ? r[w.phone] : null, w.email ? r[w.email] : null);
      if (pid) { upd.run(pid, r._rid); stats.linked++; }
    }
  }
  return stats;
}

const facName = (fid, fallback) => {
  if (fid) { try { const n = db.prepare(`SELECT name FROM org_facilities WHERE id = ?`).get(fid)?.name; if (n) return n; } catch { /* fall through */ } }
  return fallback;
};

/* The stitched cross-program timeline for one person. */
export function journeyFor(personId) {
  const person = db.prepare(`SELECT id, name, dob FROM people WHERE id = ?`).get(personId);
  if (!person) return { person: null, episodes: [] };
  const eps = [];
  try {
    for (const c of db.prepare(`SELECT id, pref, name, facility_id, admit, discharge_date, discharge_status, loc, program, active FROM clients WHERE person_id = ? AND merged_into IS NULL`).all(personId)) {
      eps.push({
        world: 'residential', label: 'Detox / Residential',
        facility: facName(c.facility_id, 'Armada Detox of Akron'),
        start: (c.admit || '').slice(0, 10) || null, end: (c.discharge_date || '').slice(0, 10) || null,
        active: !!c.active && !c.discharge_status,
        status: c.active && !c.discharge_status ? 'In treatment now' : (c.discharge_status || 'Closed'),
        detail: [c.loc && c.loc !== 'Unspecified' ? c.loc : null, c.program].filter(Boolean).join(' · '),
        ref: { kind: 'client', id: c.id },
      });
    }
  } catch { /* table optional */ }
  try {
    for (const o of db.prepare(`SELECT * FROM outpatient_clients WHERE person_id = ?`).all(personId)) {
      eps.push({
        world: 'outpatient', label: 'Outpatient (PHP / IOP)',
        facility: facName(o.facility_id, 'Armada Clinical of Akron'),
        start: (o.php_start || o.admit || o.first_seen || '').slice(0, 10) || null,
        end: (o.discharged_at || '').slice(0, 10) || null,
        active: !!o.active,
        status: o.active ? `Active — ${o.level || o.loc_class || 'outpatient'}` : `Discharged${o.discharge_loc ? ' at ' + o.discharge_loc : ''}`,
        detail: [o.level || o.loc_class, o.iop_start ? `stepped to IOP ${String(o.iop_start).slice(0, 10)}` : null].filter(Boolean).join(' · '),
        ref: { kind: 'outpatient', id: o.kipu_id },
      });
    }
  } catch { /* table optional */ }
  try {
    for (const r of db.prepare(`SELECT r.*, h.name AS house_name FROM housing_residents r LEFT JOIN housing_houses h ON h.id = r.house_id WHERE r.person_id = ?`).all(personId)) {
      eps.push({
        world: 'housing', label: 'Sober Living',
        facility: facName(r.facility_id, 'Hilltop Recovery Homes — Akron'),
        start: (r.move_in || '').slice(0, 10) || null, end: (r.discharge_date || '').slice(0, 10) || null,
        active: r.status === 'active',
        status: r.status === 'active' ? 'In house now' : `${r.status || 'out'}${r.discharge_type ? ' · ' + r.discharge_type : ''}`,
        detail: [r.house_name, r.loc].filter(Boolean).join(' · '),
        ref: { kind: 'resident', id: r.id },
      });
    }
  } catch { /* table optional */ }
  eps.sort((a, b) => String(a.start || '9999').localeCompare(String(b.start || '9999')));
  return { person, episodes: eps };
}

/* person_id for a roster row, lazily linking once if the row is new. */
export function personIdFor(table, idCol, id) {
  const get = () => { try { return db.prepare(`SELECT person_id FROM ${table} WHERE ${idCol} = ?`).get(id)?.person_id || null; } catch { return null; } };
  let pid = get();
  if (!pid) { try { linkPeople(); } catch { /* best effort */ } pid = get(); }
  return pid;
}

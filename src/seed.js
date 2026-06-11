// Seeding helpers. Used two ways:
//   1. Automatically on server boot (ensureAdmin) so a fresh deploy is usable.
//   2. Manually via `npm run seed` for local setup / sample data.
import { db } from './db.js';
import { createUser } from './auth.js';

// Create the first admin if no admin exists yet. Idempotent and safe to run every boot.
// Reads ADMIN_USER / ADMIN_PASS from the environment (set these in Render).
export function ensureAdmin({ quiet = false } = {}) {
  const adminUser = (process.env.ADMIN_USER || 'admin').toLowerCase().trim();
  const adminPass = process.env.ADMIN_PASS || 'changeme123';
  const hasAnyAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1`).get();
  if (hasAnyAdmin) return;
  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(adminUser);
  if (existing) return;
  createUser({ name: 'Administrator', username: adminUser, password: adminPass, role: 'admin', job_role: 'Nurse' });
  if (!quiet) {
    const usingDefault = !process.env.ADMIN_PASS;
    console.log(`Created admin user "${adminUser}".` +
      (usingDefault ? ' WARNING: using default password "changeme123" — set ADMIN_PASS and change it.' : ''));
  }
}

// Demo staff + one fully-filled client, so a pilot has something to look at.
export function ensureSampleData() {
  for (const s of [
    { name: 'Maria Reyes', username: 'maria', password: 'staff123', role: 'staff', job_role: 'BHT / Tech' },
    { name: 'David Okafor', username: 'david', password: 'staff123', role: 'staff', job_role: 'Therapist' },
  ]) {
    if (!db.prepare(`SELECT id FROM users WHERE username = ?`).get(s.username)) createUser(s);
  }
  if (db.prepare(`SELECT id FROM clients LIMIT 1`).get()) return;

  const info = db.prepare(`INSERT INTO clients (name, pref, room, program, admit, sober, touch, prefs, goals, triggers, safety, support)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'Jane Doe', 'Janie', '204', 'Residential — Phase 2', '2026-06-02', '2026-05-30',
    'Loves a warm oat-milk coffee at wake-up. Lights up talking about her daughter Mia (7). Prefers a gentle wake-up, not overhead lights.',
    'Vegetarian. Decaf after 2pm. Reads before bed. Values quiet morning time.',
    'Attend all 3 groups daily. Call sponsor Dave each evening. Finish Step 4 worksheet.',
    'Crowded rooms raise anxiety — offer a seat near the door. Avoid discussing her ex.',
    'Mild fall risk — stay nearby in shower. Penicillin allergy. Monitor withdrawal s/s through day 5.',
    'Mother Carol calls Sundays. Sponsor: Dave. Daughter: Mia, 7.'
  );
  const cid = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO tasks (client_id, shift, job_role, text, priority, sort) VALUES (?,?,?,?,?,?)`);
  [
    ['Morning', 'BHT / Tech', 'Gentle wake-up, bring oat-milk coffee', 'Normal'],
    ['Morning', 'Nurse', 'Morning meds + withdrawal check (day-5 watch)', 'High'],
    ['Day', 'Therapist', 'Check Step 4 worksheet progress in 1:1', 'Normal'],
    ['Evening', 'BHT / Tech', 'Remind + give privacy for sponsor call to Dave', 'Normal'],
    ['Evening', 'Kitchen', 'Vegetarian dinner plate; decaf only', 'Normal'],
  ].forEach((t, i) => ins.run(cid, t[0], t[1], t[2], t[3], i));

  const pins = db.prepare(`INSERT INTO pulses (client_id, date, shift, concern, engagement, triggers, statements, note) VALUES (?,?,?,?,?,?,?,?)`);
  const today = new Date().toISOString().slice(0, 10);
  pins.run(cid, today, 'Morning', 'Medium', 'Quiet', JSON.stringify(['Strong cravings', 'Poor sleep']),
    'Asked how long she has to stay', 'Quiet at breakfast, picked at food.');
}

// Allow `npm run seed` to set up admin + sample data locally.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAdmin();
  ensureSampleData();
  console.log('Seed complete.');
}

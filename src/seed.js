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
    'Gets discouraged in the afternoons — check in and offer a walk. Sensitive about feeling judged.',
    'Mother Carol calls Sundays. Sponsor: Dave. Daughter: Mia, 7.'
  );
  const cid = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO tasks (client_id, shift, job_role, text, priority, sort) VALUES (?,?,?,?,?,?)`);
  [
    ['Morning', 'BHT / Tech', 'Gentle wake-up, bring oat-milk coffee', 'Normal'],
    ['Morning', 'BHT / Tech', 'Warm welcome — ask about her daughter Mia', 'Normal'],
    ['Day', 'Therapist', 'Check Step 4 worksheet progress in 1:1', 'Normal'],
    ['Evening', 'BHT / Tech', 'Remind + give privacy for sponsor call to Dave', 'Normal'],
    ['Evening', 'Kitchen', 'Vegetarian dinner plate; decaf only', 'Normal'],
  ].forEach((t, i) => ins.run(cid, t[0], t[1], t[2], t[3], i));

  const pins = db.prepare(`INSERT INTO pulses (client_id, date, shift, concern, engagement, triggers, statements, note) VALUES (?,?,?,?,?,?,?,?)`);
  const today = new Date().toISOString().slice(0, 10);
  pins.run(cid, today, 'Morning', 'Medium', 'Quiet', JSON.stringify(['Strong cravings', 'Poor sleep']),
    'Asked how long she has to stay', 'Quiet at breakfast, picked at food.');
}

// A second sample built from a real (de-identified) intake — handy to demo the
// AMA-read and Care Brief on realistic answers. Idempotent: keyed on the name,
// so it loads once and never duplicates. NOTE: a relative's first name and a
// date remain in this text; it is sample/pilot data, not Safe-Harbor de-id.
export function ensureExampleClient12A() {
  if (db.prepare(`SELECT id FROM clients WHERE name = ?`).get('Sample Client 12A')) return;
  const info = db.prepare(`INSERT INTO clients (name, pref, room, program, sober, touch, prefs, triggers, support, anchor_why)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'Sample Client 12A', '12A', '12A', 'PHP', '2025-05-19',
    'Feels safest with alone time and space to collect his thoughts; music gives him a sense of security. Quiet comforts matter — extra pillow, room cool (65–68°), shower after the last group.',
    'Drinks: black coffee; loves apple juice & Coca-Cola; likes orange juice but finds it too acidic; chocolate milk at dinner. Foods: chicken parmesan, tacos, burritos, burgers & fries, seafood, salad. Nicotine: smoker — offer gum or Zyns. Comfort: shower after last group, room 65–68°, extra pillow; early bird. Interests: making music, guitar, fishing, handheld games, color & word searches.',
    'Unnecessary or rude comments. Staff (especially nurses) saying they will do something and not following through — makes him feel unheard. Staff not following the rules. Follow through on every promise and close the loop with him.',
    'Son — Rocco (5th birthday).',
    'His son Rocco (just turned 5). Sober since May 19 — proud he made it to PHP.'
  );
  const cid = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO tasks (client_id, shift, job_role, text, priority, sort) VALUES (?,?,?,?,?,?)`);
  [
    ['Morning', 'BHT / Tech', 'Early riser — greet him warmly; offer gum or a Zyn at the first smoke break.', 'Normal'],
    ['Morning', 'Kitchen', 'Black coffee at wake-up; apple juice or chocolate milk available at dinner.', 'Normal'],
    ['Day', 'BHT / Tech', 'Protect some alone time with his music — it is how he resets and feels secure.', 'Normal'],
    ['Evening', 'BHT / Tech', 'Shower after last group; set room to 65–68° and leave an extra pillow.', 'Normal'],
    ['Evening', 'All', 'CLOSE THE LOOP: if you tell him you will do something, do it and report back. Feeling unheard is his biggest AMA trigger.', 'High'],
  ].forEach((t, i) => ins.run(cid, t[0], t[1], t[2], t[3], i));
}

// Allow `npm run seed` to set up admin + sample data locally.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAdmin();
  ensureSampleData();
  ensureExampleClient12A();
  console.log('Seed complete.');
}

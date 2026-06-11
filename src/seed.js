// Seed: creates a first admin account + a sample client so you can log in immediately.
// Run once with: npm run seed
import { db } from './db.js';
import { createUser } from './auth.js';

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASS || 'changeme123';

const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(adminUser);
if (!existing) {
  createUser({ name: 'Administrator', username: adminUser, password: adminPass, role: 'admin', job_role: 'Nurse' });
  console.log(`Created admin user "${adminUser}" with password "${adminPass}" — change it after first login.`);
} else {
  console.log(`Admin "${adminUser}" already exists.`);
}

// Sample staff
for (const s of [
  { name: 'Maria Reyes', username: 'maria', password: 'staff123', role: 'staff', job_role: 'BHT / Tech' },
  { name: 'David Okafor', username: 'david', password: 'staff123', role: 'staff', job_role: 'Therapist' },
]) {
  if (!db.prepare(`SELECT id FROM users WHERE username = ?`).get(s.username)) createUser(s);
}

// Sample client
if (!db.prepare(`SELECT id FROM clients LIMIT 1`).get()) {
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
  console.log('Created sample client "Janie".');
}

console.log('Seed complete.');

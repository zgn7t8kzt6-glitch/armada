// Seeding helpers. Used two ways:
//   1. Automatically on server boot (ensureAdmin) so a fresh deploy is usable.
//   2. Manually via `npm run seed` for local setup / sample data.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, getState } from './db.js';
import { createUser } from './auth.js';

// One-time import of the org-wide employee roster (name + entity/location). Job title
// and salary are left blank for the owner to fill. Idempotent: only runs if empty.
export function ensureHrRoster({ quiet = false } = {}) {
  const have = db.prepare(`SELECT COUNT(*) n FROM hr_employees`).get().n;
  if (have) return;
  let rows;
  try { rows = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'hr-seed.json'), 'utf8')); }
  catch { return; }
  const ins = db.prepare(`INSERT INTO hr_employees (entity, last_name, first_name) VALUES (?,?,?)`);
  const tx = db.transaction ? null : null;   // node:sqlite has no .transaction(); use exec
  db.exec('BEGIN');
  try { for (const r of rows) ins.run(r.entity || '', r.last || '', r.first || ''); db.exec('COMMIT'); }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } if (!quiet) console.error('[hr seed]', e.message); return; }
  try { db.prepare(`UPDATE hr_employees SET job_title='Executive Assistant' WHERE lower(first_name)='chava' AND lower(last_name)='appel'`).run(); } catch { /* best-effort */ }
  if (!quiet) console.log(`Imported ${rows.length} employees into the HR roster.`);
}

// Create the first admin if no admin exists yet. Idempotent and safe to run every boot.
// Reads ADMIN_USER / ADMIN_PASS from the environment (set these in Render).
export function ensureAdmin({ quiet = false } = {}) {
  const adminUser = (process.env.ADMIN_USER || 'admin').toLowerCase().trim();
  const hasAnyAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND active = 1 LIMIT 1`).get();
  if (hasAnyAdmin) return;
  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(adminUser);
  if (existing) return;
  // No known-default password: if ADMIN_PASS is unset, generate a random one and
  // print it once so a fresh deploy is usable without baking a guessable secret in.
  const generated = !process.env.ADMIN_PASS;
  const adminPass = process.env.ADMIN_PASS || crypto.randomBytes(12).toString('base64url');
  createUser({ name: 'Administrator', username: adminUser, password: adminPass, role: 'admin', job_role: 'Nurse' });
  if (!quiet) {
    console.log(`Created admin user "${adminUser}".` +
      (generated ? ` IMPORTANT: ADMIN_PASS was not set — temporary password is: ${adminPass}  (set ADMIN_PASS and change it now).` : ''));
  }
}

// Chava's corporate login. Idempotent: creates it once, sets her email + Corporate
// role. Temp password from CHAVA_PASS (or generated + printed once) — she resets it.
export function ensureCorporateUser({ quiet = false } = {}) {
  const username = 'chavaa@armadarecovery.com';
  const existing = db.prepare(`SELECT id FROM users WHERE lower(username) = ? OR lower(email) = ?`).get(username, username);
  if (existing) {
    // Make sure the role/email are set even if the row pre-existed.
    db.prepare(`UPDATE users SET job_role = 'Executive Assistant', email = COALESCE(email, ?), active = 1 WHERE id = ?`).run(username, existing.id);
    return;
  }
  const generated = !process.env.CHAVA_PASS;
  const pass = process.env.CHAVA_PASS || crypto.randomBytes(9).toString('base64url');
  const u = createUser({ name: 'Chava', username, password: pass, role: 'staff', job_role: 'Executive Assistant' });
  try { db.prepare(`UPDATE users SET email = ? WHERE id = ?`).run(username, u.id || u); } catch { /* createUser return shape */ }
  if (!quiet) console.log(`Created corporate user "${username}".` + (generated ? ` Temporary password: ${pass}  (set CHAVA_PASS or have her reset it).` : ''));
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
  // Rebuild Phase 1: the demo client was inflating the real census by 1 — once
  // retired, it stays retired (and fresh installs start with a truthful zero).
  if (getState('demo_client_retired') === 'done') return;
  if (db.prepare(`SELECT id FROM clients WHERE name = ?`).get('Sample Client 12A')) return;
  // Don't seed the demo client once a real Kipu roster is present (it would
  // skew the live census count).
  if (db.prepare(`SELECT id FROM clients WHERE source = 'kipu' LIMIT 1`).get()) return;
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

// Supply Standards default catalog — the Horst "anticipate every need" list for a
// detox/residential facility, owned by department. par = target on hand, reorder =
// count at/below which we raise a reorder. critical = never-out (escalates on Out).
// Idempotent: only seeds when the catalog is empty, and never deletes admin edits.
const INVENTORY_CATALOG = [
  // ── KITCHEN (techs cover this for now) ──────────────────────────────
  // chips/crackers + fresh fruit + Gatorade now live as PFS-coded nourishment lines.
  ['Kitchen','Dry Goods & Snacks','Snacks — granola/protein bars','box',6,2,0,0],
  ['Kitchen','Dry Goods & Snacks','Cookies / sweet snacks','box',4,2,0,0],
  ['Kitchen','Drinks','Bottled water','case',10,3,1,0],
  ['Kitchen','Drinks','Juice (apple/orange/cranberry)','case',4,2,0,0],
  ['Kitchen','Drinks','Soda (regular + caffeine-free)','case',4,1,0,0],
  ['Kitchen','Drinks','Coffee — regular','bag',6,2,0,0],
  // Decaf coffee, sweetener packets, and hot chocolate live in the nourishment list (coded) — not here.
  ['Kitchen','Drinks','Tea (regular + herbal/decaf)','box',4,1,0,0],
  ['Kitchen','Condiments','Creamer','case',4,1,0,0],
  ['Kitchen','Cutlery & Paper','Plastic forks','pack',8,3,0,0],
  ['Kitchen','Cutlery & Paper','Plastic spoons','pack',8,3,0,0],
  ['Kitchen','Cutlery & Paper','Plastic knives','pack',6,2,0,0],
  ['Kitchen','Cutlery & Paper','Paper / foam plates','pack',8,3,0,0],
  ['Kitchen','Cutlery & Paper','Bowls','pack',6,2,0,0],
  ['Kitchen','Cutlery & Paper','Cups (hot + cold)','pack',10,3,0,0],
  ['Kitchen','Cutlery & Paper','Napkins','pack',8,3,0,0],
  ['Kitchen','Cutlery & Paper','Paper towels','case',6,2,0,0],
  ['Kitchen','Cutlery & Paper','Food storage / foil / wrap','box',4,1,0,0],
  ['Kitchen','Condiments','Condiments (ketchup/mustard/mayo/salt/pepper)','set',4,1,0,0],
  ['Kitchen','Cleaning','Dish soap','bottle',4,1,0,0],
  ['Kitchen','Cleaning','Sanitizer wipes — kitchen','tub',6,2,0,0],

  // ── HOUSEKEEPING ────────────────────────────────────────────────────
  ['Housekeeping','Toiletries','Toothbrushes','box',10,3,1,0],
  ['Housekeeping','Toiletries','Toothpaste','box',8,3,1,0],
  ['Housekeeping','Toiletries','Bar / body soap','box',10,3,1,0],
  ['Housekeeping','Toiletries','Shampoo + conditioner','box',8,3,1,0],
  ['Housekeeping','Toiletries','Deodorant','box',8,2,1,0],
  ['Housekeeping','Toiletries','Disposable razors','box',6,2,0,0],
  ['Housekeeping','Toiletries','Shaving cream','box',4,1,0,0],
  ['Housekeeping','Toiletries','Combs / brushes','box',6,2,0,0],
  ['Housekeeping','Toiletries','Lotion','box',4,1,0,0],
  ['Housekeeping','Toiletries','Feminine hygiene products','box',6,2,1,0],
  ['Housekeeping','Toiletries','Lip balm','box',4,1,0,0],
  ['Housekeeping','Linens','Bed sheets (sets)','set',12,4,0,0],
  ['Housekeeping','Linens','Pillowcases','each',16,5,0,0],
  ['Housekeeping','Linens','Pillows','each',8,3,0,0],
  ['Housekeeping','Linens','Blankets','each',10,3,0,0],
  ['Housekeeping','Linens','Bath towels','each',16,5,0,0],
  ['Housekeeping','Linens','Washcloths','each',20,6,0,0],
  ['Housekeeping','Clothing','Socks (new admit)','pack',8,2,0,0],
  ['Housekeeping','Clothing','Underwear (new admit, assorted)','pack',8,2,0,0],
  ['Housekeeping','Clothing','Slipper-socks / non-slip socks','pack',8,2,1,0],
  ['Housekeeping','Clothing','Robes / gowns','each',6,2,0,0],
  ['Housekeeping','Paper','Toilet paper','case',8,3,1,0],
  ['Housekeeping','Paper','Facial tissues','case',6,2,0,0],
  ['Housekeeping','Cleaning','Disinfectant / multi-surface cleaner','bottle',8,2,1,0],
  ['Housekeeping','Cleaning','Bleach','bottle',6,2,0,0],
  ['Housekeeping','Cleaning','Glass cleaner','bottle',3,1,0,0],
  ['Housekeeping','Cleaning','Toilet bowl cleaner','bottle',4,1,0,0],
  ['Housekeeping','Cleaning','Disinfecting wipes','tub',10,3,1,0],
  ['Housekeeping','Cleaning','Mop heads','each',6,2,0,0],
  ['Housekeeping','Cleaning','Sponges / scrubbers','pack',4,1,0,0],
  ['Housekeeping','Cleaning','Hand soap refills','bottle',8,2,1,0],
  ['Housekeeping','Cleaning','Hand sanitizer refills','bottle',8,2,1,0],
  ['Housekeeping','Laundry','Laundry detergent','jug',6,2,1,0],
  ['Housekeeping','Laundry','Dryer sheets','box',4,1,0,0],
  ['Housekeeping','Laundry','Laundry bags','each',8,2,0,0],
  ['Housekeeping','Trash','Trash bags — regular','box',8,3,1,0],
  ['Housekeeping','Trash','Trash bags — large/contractor','box',4,1,0,0],

  // ── FRONT DESK / ADMIN ──────────────────────────────────────────────
  ['Front Desk','Welcome','New-admit welcome / dignity kits','each',10,3,1,0],
  ['Front Desk','Welcome','Patient ID wristbands','box',4,1,0,0],
  ['Front Desk','Office','Pens','box',6,2,0,0],
  ['Front Desk','Office','Copy paper','ream',8,2,0,0],
  ['Front Desk','Office','Printer toner / ink','each',3,1,1,0],
  ['Front Desk','Office','Labels','pack',3,1,0,0],
  ['Front Desk','Office','Lanyards / badge holders','each',10,3,0,0],
  ['Front Desk','Forms','Intake packets','pack',6,2,1,0],
  ['Front Desk','Forms','Consent / ROI forms','pack',6,2,0,0],
  ['Front Desk','Office','Visitor sign-in sheets','pack',3,1,0,0],

  // ── MEDICAL / CLINICAL (non-controlled supplies) ────────────────────
  ['Medical','PPE','Nitrile gloves (S/M/L)','box',12,4,1,0],
  ['Medical','PPE','Face masks','box',10,3,1,0],
  ['Medical','PPE','Gowns','pack',6,2,0,0],
  ['Medical','Vitals','Thermometer probe covers','box',6,2,1,0],
  ['Medical','Vitals','BP cuff (working spares)','each',2,1,1,0],
  ['Medical','Vitals','Pulse oximeter (working spares)','each',2,1,1,0],
  ['Medical','Vitals','AA/AAA batteries (vitals devices)','pack',6,2,1,0],
  ['Medical','Testing','Urine drug screen (UDS) cups','box',8,3,1,0],
  ['Medical','Testing','Breathalyzer mouthpieces','box',4,1,0,0],
  ['Medical','Testing','Glucometer test strips','box',4,1,1,1],
  ['Medical','Testing','Lancets','box',4,1,0,0],
  ['Medical','OTC / Comfort','OTC comfort meds (per protocol)','set',1,1,1,1],
  ['Medical','First Aid','Adhesive bandages','box',6,2,1,0],
  ['Medical','First Aid','Gauze / wound supplies','box',4,2,1,0],
  ['Medical','First Aid','Alcohol prep pads','box',6,2,1,0],
  ['Medical','First Aid','Antibiotic ointment','tube',4,1,0,0],
  ['Medical','Critical Safety','Naloxone / Narcan kits','kit',6,3,1,1],
  ['Medical','Critical Safety','AED pads (in-date)','set',2,1,1,1],
  ['Medical','Critical Safety','AED battery','each',1,1,1,1],
  ['Medical','Biohazard','Sharps containers','each',4,1,1,0],
  ['Medical','Biohazard','Biohazard / red bags','box',3,1,1,0],
  ['Medical','Biohazard','Bodily-fluid spill kit','each',2,1,1,0],

  // ── SAFETY / FACILITY / ENVIRONMENTAL ───────────────────────────────
  ['Safety','Detectors','Smoke/CO detector batteries (9V)','pack',4,2,1,0],
  ['Safety','Lighting','Light bulbs (assorted)','pack',4,1,0,0],
  ['Safety','Lighting','Flashlights (working) + batteries','each',4,2,1,0],
  ['Safety','Fire','Fire extinguisher — inspection in-date','each',1,1,1,1],
  ['Safety','Environment','Air freshener','each',4,1,0,0],
  ['Safety','Environment','Pest control / traps','set',2,1,0,0],
];

export function ensureInventoryCatalog() {
  if (db.prepare(`SELECT id FROM inventory_items LIMIT 1`).get()) return;
  const ins = db.prepare(`INSERT INTO inventory_items
    (department, category, name, unit, par_level, reorder_point, critical, track_expiry, sort)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  INVENTORY_CATALOG.forEach((r, i) =>
    ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], i));
}

// Items found on a building walk — added to whatever catalog already exists,
// ONLY if an item with that name isn't already there (so it never duplicates and
// never wipes live edits). Par levels are sensible starting points to tune in-app.
const INVENTORY_EXTRA = [
  // Med room / med pass
  ['Medical', 'Med Pass', '0.5 oz soufflé cups', 'sleeve', 8, 3, 0, 0],
  ['Medical', 'Med Pass', '1 oz graduated medication cups', 'sleeve', 8, 3, 0, 0],
  ['Medical', 'Med Pass', '3 oz water cups', 'sleeve', 10, 3, 0, 0],
  ['Medical', 'Med Pass', 'Pill crushing pouches', 'box', 4, 2, 0, 0],
  ['Medical', 'Med Pass', 'Drug Buster disposal system', 'each', 3, 1, 1, 0],
  ['Medical', 'Med Pass', 'CPR mask', 'each', 3, 1, 1, 0],
  // OTC meds & comfort (expiry-tracked)
  ['Medical', 'OTC / Comfort', 'Tylenol (acetaminophen)', 'bottle', 4, 2, 1, 1],
  ['Medical', 'OTC / Comfort', 'Tums', 'bottle', 4, 2, 1, 1],
  ['Medical', 'OTC / Comfort', 'Maalox', 'bottle', 3, 1, 0, 1],
  ['Medical', 'OTC / Comfort', 'Milk of Magnesia', 'bottle', 3, 1, 0, 1],
  ['Medical', 'OTC / Comfort', 'MiraLAX', 'bottle', 3, 1, 0, 1],
  ['Medical', 'OTC / Comfort', 'Antacid + gas relief', 'bottle', 3, 1, 0, 1],
  ['Medical', 'OTC / Comfort', 'Mucus relief / nasal decongestant', 'box', 3, 1, 0, 1],
  ['Medical', 'OTC / Comfort', 'Cough drops', 'bag', 4, 2, 0, 1],
  ['Medical', 'OTC / Comfort', 'Nicotine gum', 'box', 6, 2, 1, 1],
  ['Medical', 'OTC / Comfort', 'Nicotine patches', 'box', 6, 2, 1, 1],
  ['Medical', 'OTC / Comfort', 'Vaseline', 'jar', 3, 1, 0, 0],
  ['Medical', 'OTC / Comfort', 'Baking soda', 'box', 3, 1, 0, 0],
  ['Medical', 'OTC / Comfort', 'Hydrocortisone cream', 'tube', 3, 1, 0, 1],
  // Wound care / first aid
  ['Medical', 'First Aid', 'Medical tape', 'roll', 6, 2, 0, 0],
  ['Medical', 'First Aid', '4x4 nonwoven gauze pads', 'box', 6, 2, 1, 0],
  ['Medical', 'First Aid', 'Conforming stretch gauze bandage', 'box', 4, 2, 0, 0],
  // Hydration & nutrition
  // Ginger ale, protein boost/shakes, Jello, yogurt, milk now live as PFS-coded
  // nourishment lines (Ginger ale caffeine-free, Boost/Ensure, Gelatin, Greek
  // yogurt, Whole milk). Orange juice stays — no coded equivalent on the order.
  ['Kitchen', 'Drinks', 'Orange juice', 'case', 4, 1, 0, 1],
  // Nurse beverage station
  ['Kitchen', 'Condiments', 'Splenda', 'box', 3, 1, 0, 0],
  // Peanut butter lives in the nourishment list (Condiments, 60-packet case) — not here.
  // Jelly lives in the nourishment list (box of 200 packets, GP564) — not here.
  ['Kitchen', 'Fresh & Refrigerated', 'Butter', 'case', 3, 1, 0, 1],
  ['Kitchen', 'Condiments', 'Garlic powder', 'each', 2, 1, 0, 0],
  // Personal care / hygiene
  ['Housekeeping', 'Toiletries', 'Nail clippers', 'each', 8, 2, 0, 0],
  ['Housekeeping', 'Clothing', 'Adult underwear (assorted, for anyone)', 'pack', 8, 2, 0, 0],
  ['Housekeeping', 'Toiletries', 'Tampons', 'box', 6, 2, 1, 0],
  ['Housekeeping', 'Toiletries', 'Earplugs', 'box', 6, 2, 0, 0],
  ['Housekeeping', 'Toiletries', 'Kleenex tissues', 'case', 6, 2, 0, 0],
  ['Front Desk', 'Welcome', 'Dignity kit bags', 'pack', 6, 2, 0, 0],
  // Housekeeping & laundry
  ['Housekeeping', 'Cleaning', 'Febreze', 'bottle', 4, 1, 0, 0],
  ['Housekeeping', 'Cleaning', 'Lysol spray', 'can', 6, 2, 1, 0],
  // Office / front desk
  ['Front Desk', 'Office', 'Scissors', 'each', 4, 1, 0, 0],
  ['Front Desk', 'Office', 'Markers', 'pack', 3, 1, 0, 0],
  ['Front Desk', 'Office', 'Sharpies', 'pack', 3, 1, 0, 0],
  ['Front Desk', 'Office', 'Highlighters', 'pack', 3, 1, 0, 0],
  ['Front Desk', 'Office', 'Staples', 'box', 3, 1, 0, 0],
  ['Front Desk', 'Office', 'Paper clips', 'box', 3, 1, 0, 0],
  ['Front Desk', 'Office', 'Sticky notes', 'pack', 4, 1, 0, 0],
  // Facilities
  ['Safety', 'Environment', 'Culligan water filters', 'each', 4, 2, 1, 0],
  ['Safety', 'Environment', 'Lighters (large)', 'each', 4, 2, 0, 0],
];
export function ensureInventoryItems() {
  const has = db.prepare(`SELECT 1 FROM inventory_items WHERE name = ? COLLATE NOCASE LIMIT 1`);
  const max = db.prepare(`SELECT COALESCE(MAX(sort), 0) m FROM inventory_items`).get().m;
  const ins = db.prepare(`INSERT INTO inventory_items
    (department, category, name, unit, par_level, reorder_point, critical, track_expiry, sort)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  INVENTORY_EXTRA.forEach((r) => { if (!has.get(r[2])) { ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], max + 1 + n); n++; } });
  return n;
}

// The facility staffing standard — how many of each role per shift. Seeded once;
// admins tune the needed counts in-app. Drives the per-shift coverage check.
const STAFFING_STANDARD = [
  ['Nursing — Day', 'Nursing Supervisor', '7a–7p', 1],
  ['Nursing — Day', 'Intake RN', '7a–7p', 1],
  ['Nursing — Day', 'LPN', '7a–7p', 2],
  ['Nursing — Night', 'RN', '7p–7a', 1],
  ['Nursing — Night', 'LPN', '7p–7a', 1],
  ['RT / BHT', 'RT', '7a–3p', 2],
  ['RT / BHT', 'RT', '3p–11p', 2],
  ['RT / BHT', 'RT', '11p–7a', 2],
  ['Case Mgmt / Therapist', 'Case Mgmt / Therapist', '8a–4p', 3],
  ['Case Mgmt / Therapist', 'Case Mgmt / Therapist', '2p–10p', 2],
  ['Support', 'Housekeeper', 'Day', 1],
  ['Support', 'Receptionist', 'Day', 1],
];
export function ensureStaffingStandard() {
  if (db.prepare(`SELECT id FROM staffing_standard LIMIT 1`).get()) return;
  const ins = db.prepare(`INSERT INTO staffing_standard (block, role, shift_label, needed, sort) VALUES (?,?,?,?,?)`);
  STAFFING_STANDARD.forEach((r, i) => ins.run(r[0], r[1], r[2], r[3], i));
}

// Pre-load the weekly-grid shift rows from Armada's actual schedule: the real
// shift names (RN Intake, LPN Floor, Resident Tech…) mapped to standard roles,
// with the time kept in the label. Seeds once; soft-deleted rows keep the table
// non-empty so a removed row never comes back.
const SHIFT_TEMPLATES = [
  ['Nurse', 'RN Intake · 7a–7p'],
  ['Nurse', 'RN Intake/Floor · 7a–7p'],
  ['Nurse', 'LPN Floor · 7a–7p'],
  ['Nurse', 'LPN Floor · 7:30a–7:30p'],
  ['Nurse', 'RN · 7p–7a'],
  ['Nurse', 'LPN · 7p–7a'],
  ['Therapist', 'Therapist · 8a–4p'],
  ['Case Manager', 'Case Manager · 8a–4p'],
  ['Case Manager', 'Case Manager · 2p–10p'],
  ['BHT / Tech', 'Resident Tech · 7a–3p'],
  ['BHT / Tech', 'Resident Tech · 3p–11p'],
  ['BHT / Tech', 'Resident Tech · 11p–7a'],
  ['Front Desk', 'Front Desk · 8a–4p'],
];
function partFromLabelSeed(label) {
  const m = String(label).match(/(\d{1,2})(?::\d{2})?\s*([ap])/i);
  let h = m ? (+m[1] % 12) + (/p/i.test(m[2]) ? 12 : 0) : 12;
  if (h >= 5 && h < 11) return 'Morning';
  if (h >= 11 && h < 16) return 'Day';
  if (h >= 16 && h < 21) return 'Evening';
  return 'Night';
}
export function ensureShiftTemplates() {
  if (db.prepare(`SELECT id FROM shift_templates LIMIT 1`).get()) return 0;
  const ins = db.prepare(`INSERT INTO shift_templates (role, shift_label, part, sort) VALUES (?,?,?,?)`);
  SHIFT_TEMPLATES.forEach((r, i) => ins.run(r[0], r[1], partFromLabelSeed(r[1]), i));
  return SHIFT_TEMPLATES.length;
}

// Gold-standard arrival checklists for every department — what a best-in-class
// detox does to welcome a client. Tune to what's actually in place. Additive:
// only inserts items not already present, so it augments without duplicating.
const ARRIVAL_ITEMS = [
  // ── FRONT DESK / RECEPTION — the very first impression ──────────────
  ['Front Desk', 'Greet by name the moment they walk in — warm, unhurried, eye contact'],
  ['Front Desk', 'Offer water/coffee and a seat; reassure them they are safe and in the right place'],
  ['Front Desk', 'Confirm the scheduled arrival / mark "arrived" on the board'],
  ['Front Desk', 'Verify identity; copy photo ID & insurance card'],
  ['Front Desk', 'Collect / confirm emergency contact & next of kin'],
  ['Front Desk', 'Secure phone/valuables per policy with a signed receipt'],
  ['Front Desk', 'Give the welcome packet / what-to-expect'],
  ['Front Desk', 'Intake complete — notify nurse, techs & CM for assessment (auto-alerts the team)'],
  ['Front Desk', 'Update the welcome board / room assignment'],
  // ── HOUSEKEEPING — room ready before they arrive ───────────────────
  ['Housekeeping', 'Room cleaned, sanitized, and inspected before arrival'],
  ['Housekeeping', 'Bed made with fresh linens; extra blanket + pillow'],
  ['Housekeeping', 'Bathroom stocked — toilet paper, soap, fresh towels'],
  ['Housekeeping', 'Trash emptied; surfaces wiped; floor clean'],
  ['Housekeeping', 'Room smells fresh (not bleach-harsh)'],
  ['Housekeeping', 'Temperature comfortable; all lighting works'],
  ['Housekeeping', 'Welcome / dignity kit placed in the room'],
  // ── RT / BHT — the tech intake & orientation ───────────────────────
  ['RT / BHT', 'Greet by name, warm welcome; orient to the unit'],
  ['RT / BHT', 'Search belongings for contraband — with the client, dignity intact'],
  ['RT / BHT', 'Inventory & secure valuables/belongings (signed)'],
  ['RT / BHT', 'Issue welcome / dignity kit + hygiene supplies'],
  ['RT / BHT', 'Provide clean facility clothing / non-slip socks if needed'],
  ['RT / BHT', 'Set up room/bed — linens, towels, water at bedside'],
  ['RT / BHT', 'Review unit rules, daily schedule, phone & smoking/vape policy'],
  ['RT / BHT', 'Explain the call-light / how to get help any time'],
  ['RT / BHT', 'Offer food/drink (the Table) + water'],
  ['RT / BHT', 'Show bathroom, common areas, nurse station, exits'],
  ['RT / BHT', 'Start the Care Card — preferences + why they came (anchor)'],
  ['RT / BHT', 'Introduce to peers / assign a buddy'],
  ['RT / BHT', 'Hand off to nurse for vitals & assessment'],
  ['RT / BHT', 'Document arrival time + condition'],
  // ── NURSE (RN / LPN) — the medical intake ──────────────────────────
  ['Nurse', 'Baseline vitals (BP, HR, temp, RR, O2) + weight & height'],
  ['Nurse', 'COWS / CIWA baseline withdrawal assessment'],
  ['Nurse', 'Full nursing admission assessment (history, substances, last use)'],
  ['Nurse', 'Medication reconciliation — current meds, doses, last taken'],
  ['Nurse', 'Allergies & reactions documented'],
  ['Nurse', 'Suicide-risk + fall-risk screen; skin/wound assessment'],
  ['Nurse', 'Pregnancy test if applicable; pain assessment'],
  ['Nurse', 'Initiate detox / comfort protocol per provider orders'],
  ['Nurse', 'Administer first comfort meds as ordered'],
  ['Nurse', 'Naloxone education; ensure a kit is in the room'],
  ['Nurse', 'Review/secure meds the client brought, per policy'],
  ['Nurse', 'Notify provider of any red flags (vitals, withdrawal severity)'],
  // ── PROVIDER / MEDICAL — orders & H&P ──────────────────────────────
  ['Provider / Medical', 'History & physical within the required timeframe'],
  ['Provider / Medical', 'Assess withdrawal risk; write detox / taper orders'],
  ['Provider / Medical', 'Reconcile and order home meds as appropriate'],
  ['Provider / Medical', 'Order labs / UDS / EKG as indicated'],
  ['Provider / Medical', 'Document diagnosis + level-of-care (ASAM) justification'],
  ['Provider / Medical', 'Be reachable for nursing escalations'],
  // ── CASE MGMT / THERAPIST — clinical & coordination ────────────────
  ['Case Mgmt / Therapist', 'Intake packet + consents / ROI signed'],
  ['Case Mgmt / Therapist', 'Insurance verified + authorization started'],
  ['Case Mgmt / Therapist', 'Assign primary therapist / case manager — introduce in person'],
  ['Case Mgmt / Therapist', 'Start biopsychosocial (within 24h)'],
  ['Case Mgmt / Therapist', 'Begin individualized treatment plan'],
  ['Case Mgmt / Therapist', 'Capture goals — what success looks like for them'],
  ['Case Mgmt / Therapist', 'Identify legal/court, employment, housing, family needs'],
  ['Case Mgmt / Therapist', 'Confirm who is in their corner (support/aftercare contact)'],
  ['Case Mgmt / Therapist', 'Explain the program, groups, and what to expect this week'],
  // ── KITCHEN — the Table, from minute one ───────────────────────────
  ['Kitchen', 'Note dietary needs & allergies from intake'],
  ['Kitchen', 'Have a warm welcome meal/snack + drink ready'],
  ['Kitchen', 'Offer comfort food — they may not have eaten'],
  ['Kitchen', 'Stock the unit with water + electrolyte drinks'],
  ['Kitchen', 'Confirm detox hydration/nutrition plan (protein, electrolytes)'],
];
// Additive: inserts only items not already present (by role + label), so it
// augments an existing checklist without duplicating or wiping edits.
export function ensureArrivalItems() {
  const has = db.prepare(`SELECT 1 FROM arrival_items WHERE role = ? AND label = ? LIMIT 1`);
  const ins = db.prepare(`INSERT INTO arrival_items (role, label, sort) VALUES (?,?,?)`);
  let n = 0;
  ARRIVAL_ITEMS.forEach((r, i) => { if (!has.get(r[0], r[1])) { ins.run(r[0], r[1], i); n++; } });
  return n;
}

// The Director of Operations' recurring task manager — daily/weekly/monthly
// routines so she walks in knowing exactly what to do. Tunable in-app.
const OPS_ROUTINES = [
  // [title, cadence, dow, dom, link]
  ['Morning stock check — anything below par?', 'daily', null, null, 'inventory'],
  ['Walk the building — environment check this shift (beds/rooms/common/kitchen)', 'daily', null, null, 'operations'],
  ['Confirm today AND tomorrow are fully staffed', 'daily', null, null, 'staffmodel'],
  ['Clear maintenance defects — assign an owner + date to each', 'daily', null, null, 'maintenance'],
  ['Snack station stocked 24/7 + meals on track', 'daily', null, null, 'meals'],
  ['Shift handoff prepped before change of shift (stock/beds/kitchen/smokes)', 'daily', null, null, 'operations'],
  ['Log any CEO rescue from yesterday (goal: zero)', 'daily', null, null, 'operations'],
  // Weekly
  ['Build next week\'s schedule — a week ahead, nights & weekends named', 'weekly', 4, null, 'staffmodel'],
  ['Vendor & reorder review — prices, lead times, standing orders', 'weekly', 1, null, 'inventory'],
  ['Advance every open project on its date', 'weekly', 1, null, 'operations'],
  ['Deep environment audit — walk every room to standard', 'weekly', 5, null, 'operations'],
  // Monthly
  ['Full par-level review — adjust pars to real usage', 'monthly', null, 1, 'inventory'],
  ['Vendor cost review — control spend, confirm reliability', 'monthly', null, 1, 'inventory'],
  ['Review the month\'s operations scorecard', 'monthly', null, 1, 'operations'],
];
export function ensureOpsRoutines() {
  if (db.prepare(`SELECT id FROM ops_routines LIMIT 1`).get()) return;
  const ins = db.prepare(`INSERT INTO ops_routines (title, cadence, dow, dom, link, sort) VALUES (?,?,?,?,?,?)`);
  OPS_ROUTINES.forEach((r, i) => ins.run(r[0], r[1], r[2], r[3], r[4], i));
}

// The nourishment order (detox-appropriate), with PFS product codes. Lives under
// the Kitchen department, grouped for inventory. Off-guide items (no PFS code)
// are flagged to source. Additive: inserts missing items by name and backfills
// the product code on any that already exist.
// [category, name, unit, par, reorder, expiry, sku, note]
// Units sourced from Pollak Food Distributors invoice (June 2026).
// Categories: Drinks | Fresh & Refrigerated | Dry Goods & Snacks | Condiments
// [category, name, unit, par, reorder, expiry, sku, note]
const NOURISHMENT = [
  // ── DRINKS (beverage shelf / station) ───────────────────────────────────
  // Client favourites in detox/SUD: sparkling water and coconut water are
  // heavily requested; hot chocolate is a comfort drink for withdrawal nights.
  ['Drinks', 'Sparkling water / seltzer',      'case (24)',            6, 2, 0, null,                    'Client favourite — refreshing, helps with nausea. Source from Pollak or Sysco.'],
  ['Drinks', 'Coconut water',                  'case (12)',            4, 2, 0, null,                    'Natural electrolytes — popular alternative to Gatorade. Source separately.'],
  ['Drinks', 'Hot chocolate mix packets',      'case (50 packets)',    4, 2, 0, null,                    'Comfort drink — popular at night in withdrawal. Off-guide; source separately.'],
  ['Drinks', 'Gatorade Zero Watermelon',       'case (24)',            6, 2, 0, 'PL620',                 null],
  ['Drinks', 'Gatorade G2 Fruit Punch',        'case (24)',            6, 2, 0, 'B4678',                 null],
  ['Drinks', 'Gatorade G2 Grape',              'case (24)',            6, 2, 0, '27472',                 null],
  ['Drinks', 'Clear protein — Apple Cranberry','case (24)',            4, 2, 0, 'TG782',                 null],
  ['Drinks', 'Clear protein — Peach Mango',    'case (24)',            4, 2, 0, 'PC892',                 null],
  ['Drinks', 'Ginger ale, caffeine-free',      'case (24)',            4, 1, 0, '33206',                 null], // Pollak S01230
  ['Drinks', 'Boost Very Vanilla',             'case (24)',            6, 2, 0, 'FJ412',                 null], // Pollak 2N186000
  ['Drinks', 'Boost Wildberry',                'case (24)',            6, 2, 0, 'FJ334',                 null], // Pollak 2N186600
  ['Drinks', 'Ensure Chocolate',               'case (24)',            6, 2, 0, 'C5698',                 null],
  ['Drinks', 'Glucerna Chocolate (diabetic)',  'case (24)',            4, 2, 0, 'J3080',                 null], // Pollak 2N360200
  ['Drinks', 'Prune juice',                    'case (8)',             4, 2, 0, 'JU2050',                'Opioid-withdrawal constipation.'], // Pollak JU2050
  // ── FRESH & REFRIGERATED ────────────────────────────────────────────────
  // String cheese and hard-boiled eggs are the #1 requested protein snacks
  // in residential SUD — easy to grab, no prep, finger food.
  ['Fresh & Refrigerated', 'String cheese (individual)', 'case (48)',        6, 2, 1, null,        'Client favourite — easy protein, no prep. Source from Pollak refrigerated.'],
  ['Fresh & Refrigerated', 'Hard-boiled eggs (packaged)', 'case (24)',       4, 2, 1, null,        'Client favourite — quick protein. Check Pollak refrigerated section.'],
  ['Fresh & Refrigerated', 'Baby carrots (bags)',        'case (12 bags)',   4, 2, 1, null,        'Veggie crunch — helps oral fixation in early recovery. Source fresh.'],
  ['Fresh & Refrigerated', 'Hummus cups',                'case (36)',        4, 2, 1, null,        'Protein + snack, popular with carrots or pretzels. Source from Pollak.'],
  ['Fresh & Refrigerated', 'Whole milk',               'case (50 × 8 oz)',   4, 1, 1, 'CF162',    null], // Pollak DP0013
  ['Fresh & Refrigerated', 'Greek yogurt (assorted)',  'case (48)',          6, 2, 1, 'A4532 / A4530 / A2056', null], // Pollak DP1520/1550/1515
  ['Fresh & Refrigerated', 'Cheese sticks',            'case',              6, 2, 1, 'GR878 / BD270', null],
  ['Fresh & Refrigerated', 'Plain bagels',             'case (12 bags/6)', 4, 1, 1, 'RW814',     null], // Pollak BR1045
  ['Fresh & Refrigerated', 'White Pullman bread (toast)', 'case (12 loaves)', 4, 1, 1, '13830',  null], // Pollak BR1016
  ['Fresh & Refrigerated', 'Cream cheese',             'case (100 packets)', 3, 1, 1, 'BW730',   null], // Pollak CH1061
  ['Fresh & Refrigerated', 'Bananas',                  '40-lb case',        4, 1, 1, '13746',    null], // Pollak PC0005
  ['Fresh & Refrigerated', 'Golden apples',            'case (138 ct)',      3, 1, 1, '97582',    'Order to census'],
  ['Fresh & Refrigerated', 'Red apples',               'case (138 ct)',      3, 1, 1, '80062 / 13164', 'Order to census'], // Pollak PC0003B
  ['Fresh & Refrigerated', 'Oranges',                  'case (138 ct)',      3, 1, 1, 'GC968 / 16168', 'Order to census'], // Pollak PC0081
  ['Fresh & Refrigerated', 'Red grapes',               'flat',              3, 1, 1, '13762',    'Order to census'], // Pollak PC0037
  ['Fresh & Refrigerated', 'Strawberries',             'flat',              3, 1, 1, '39142',    'Order to census'], // Pollak PC1023
  // ── DRY GOODS & SNACKS (dry storage shelves) ────────────────────────────
  // Ramen and mac & cheese are the most requested comfort foods in detox —
  // familiar, warm, easy on a queasy stomach. Granola bars and PB crackers
  // are constant snack requests. Fruit cups fill in when fresh produce runs out.
  ['Dry Goods & Snacks', 'Ramen noodles, chicken',         'case (24)',           6, 2, 0, null,      'Client favourite #1 comfort food — warm, salty, familiar. Source Pollak or Sysco.'],
  ['Dry Goods & Snacks', 'Mac & cheese cups (microwaveable)', 'case (12)',        4, 2, 0, null,      'Client favourite comfort food — quick, warm, filling. Source from Pollak.'],
  ['Dry Goods & Snacks', 'Graham crackers',                 'case (200 packets)', 4, 2, 0, null,      'Classic comfort snack — popular with peanut butter or Nutella. Source Pollak.'],
  ['Dry Goods & Snacks', 'Cheez-Its (vend pack)',           'case (60 bags)',      4, 2, 0, null,      'Top requested salty snack in residential SUD. Source from Pollak.'],
  ['Dry Goods & Snacks', 'Granola bars (variety)',          'case (48)',           4, 2, 0, null,      'Energy + easy to eat. Nutrigrain on Pollak (CE0927 48/1). Popular with clients.'],
  ['Dry Goods & Snacks', 'Peanut butter cracker packs',     'case (60 packs)',     4, 2, 0, null,      'Client favourite — Lance PB crackers. Check Pollak alongside saltines CR1040.'],
  ['Dry Goods & Snacks', 'Trail mix / mixed nut packs',     'case (48)',           4, 2, 0, null,      'Protein + energy — popular afternoon snack. Source from Pollak or Sysco.'],
  ['Dry Goods & Snacks', 'Fruit cups (peaches / mixed)',    'case (72 × 4 oz)',    4, 2, 0, null,      'Popular when fresh fruit runs out — in juice, not syrup. Source Pollak.'],
  ['Dry Goods & Snacks', 'Mandarin orange cups',            'case (72 × 4 oz)',    4, 2, 0, null,      'Client favourite — sweet, easy, no mess. Source Pollak (similar to AP1072).'],
  ['Dry Goods & Snacks', 'Animal crackers',                 'case (72 bags)',       3, 1, 0, null,      'Comfort snack — nostalgic, light, popular. Source from Pollak.'],
  ['Dry Goods & Snacks', 'Saltines',                       'case (500 packs)',    4, 2, 0, 'K4940',   null], // Pollak CR1040
  ['Dry Goods & Snacks', 'Cream of Wheat / farina',        'case (144 packets)', 4, 1, 0, 'GT506',   null], // Pollak CE5035
  ['Dry Goods & Snacks', 'Gelatin, regular',               'case (12 × 4-pack)', 4, 1, 0, '23736',   null], // Pollak GE1500
  ['Dry Goods & Snacks', 'Gelatin, sugar-free',            'case (12 × 4-pack)', 4, 1, 0, 'M3476',   null], // Pollak GE5040
  ['Dry Goods & Snacks', 'Pudding, sugar-free',            'case (12 × 4-pack)', 4, 1, 0, '68652',   null], // Pollak PD3010
  ['Dry Goods & Snacks', 'Pudding, vanilla',               'case (12 × 4-pack)', 4, 1, 0, 'C7352',   null], // Pollak PD3050
  ['Dry Goods & Snacks', 'Corn Flakes',                    'case (96 bowls)',     3, 1, 0, '26304',   null], // Pollak CE3310
  ['Dry Goods & Snacks', 'Honey Nut Toasted Oat',          'case (96 bowls)',     3, 1, 0, '17812',   null], // Pollak CE3337
  ['Dry Goods & Snacks', 'Frosted Flakes (sugary — cap qty)', 'case (96 bowls)', 2, 1, 0, '26312',   'Craving release valve; alt: Fruit Whirls 26318'], // Pollak CE3320
  ['Dry Goods & Snacks', 'Instant oatmeal packets',        'case (64 packets)',  4, 2, 0, 'CE5105',  'Fiber + steadier breakfast than cereal.'], // Pollak CE5105
  ['Dry Goods & Snacks', 'Pretzels',                       'case (60 bags)',      4, 2, 0, 'C3266',   'Lead with savory over sweets'], // Pollak PR2060
  ['Dry Goods & Snacks', 'Chex Mix Cheddar',               'case',               4, 2, 0, 'AV480',   null],
  ['Dry Goods & Snacks', 'Potato chips',                   'case (60 bags)',      4, 2, 0, 'CB440',   null], // Pollak PR2050
  ['Dry Goods & Snacks', 'Tortilla chips',                 'case (50 bags)',      4, 2, 0, 'P5334',   null], // Pollak PR2054
  ['Dry Goods & Snacks', 'Applesauce cups',                'case (72 × 4 oz)',   4, 2, 0, 'AP1072',  'BRAT staple.'], // Pollak AP1072
  ['Dry Goods & Snacks', 'Chicken noodle soup',            'case (24)',           6, 2, 0, 'SC2010',  null], // Pollak SC2010
  ['Dry Goods & Snacks', 'Chicken broth',                  'case',               6, 2, 0, null,       'NOT on Pollak — source separately. Biggest savory gap.'],
  ['Dry Goods & Snacks', 'Beef broth',                     'case',               4, 2, 0, null,       'NOT on Pollak — source separately.'],
  ['Drinks', 'Decaf coffee',                   'case (48 × 8 oz)',   4, 2, 0, 'CF1574',  'Pair with Ridgeline regular coffee.'], // Pollak CF1574
  ['Drinks', 'Chamomile / caffeine-free tea',  'case (5 × 100 bags)', 4, 1, 0, 'CF3030', 'Anxiety + sleep support.'], // Pollak CF3030
  ['Drinks', 'Ginger chews / ginger tea',      'case',               4, 1, 0, null,       'NOT on Pollak — source separately. Active nausea.'],
  // ── CONDIMENTS ──────────────────────────────────────────────────────────
  ['Condiments', 'Honey packets',            'case (200 packets)',   4, 1, 0, null,     'For tea and hot chocolate — popular in detox. Check Pollak condiment section.'],
  ['Condiments', 'Nutella / chocolate hazelnut packets', 'case (200 packets)', 3, 1, 0, null, 'Comfort condiment — popular with bagels and graham crackers. Source separately.'],
  ['Condiments', 'Sweetener packets',        'case (2,000 packets)', 4, 1, 0, null,     null], // Pollak CN1210
  ['Condiments', 'Sugar-free syrup',         'case (100 cups)',      2, 1, 0, '10772',  null], // Pollak CN5071
  ['Condiments', 'Jelly',                    'box (200 packets)',    2, 1, 0, 'GP564',  'Regular — Pollak CN1090H'],
  ['Condiments', 'Jelly, diet / sugar-free', 'box (200 packets)',    2, 1, 0, null,     'Pollak CN5041 (Heinz Diet, 200 packets, 3 flavors) — confirm code'],
  ['Condiments', 'Peanut butter',            'case (60 packets)',    4, 1, 0, 'DV690',  null], // Pollak CN1145
];
export function ensureNourishment() {
  const has      = db.prepare(`SELECT id, sku FROM inventory_items WHERE name = ? COLLATE NOCASE LIMIT 1`);
  const max      = db.prepare(`SELECT COALESCE(MAX(sort),0) m FROM inventory_items`).get().m;
  const ins      = db.prepare(`INSERT INTO inventory_items (department, category, name, unit, par_level, reorder_point, critical, track_expiry, sku, notes, sort) VALUES ('Kitchen',?,?,?,?,?,0,?,?,?,?)`);
  const setSku   = db.prepare(`UPDATE inventory_items SET sku      = ? WHERE id = ? AND (sku IS NULL OR sku = '')`);
  const setUnit  = db.prepare(`UPDATE inventory_items SET unit     = ? WHERE id = ?`);
  const setCat   = db.prepare(`UPDATE inventory_items SET category = ? WHERE id = ?`);
  let n = 0;
  NOURISHMENT.forEach((r, i) => {
    const ex = has.get(r[1]);
    if (ex) {
      if (r[6]) setSku.run(r[6], ex.id);
      setUnit.run(r[2], ex.id);  // keep unit in sync with invoice data
      setCat.run(r[0], ex.id);   // keep category in sync with seed
    } else {
      ins.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], max + 1 + n);
      n++;
    }
  });
  return n;
}

// Allow `npm run seed` to set up admin + sample data locally.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAdmin();
  ensureSampleData();
  ensureExampleClient12A();
  ensureInventoryCatalog();
  ensureInventoryItems();
  ensureStaffingStandard();
  ensureArrivalItems();
  ensureOpsRoutines();
  ensureNourishment();
  console.log('Seed complete.');
}

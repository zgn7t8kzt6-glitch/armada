// Seeding helpers. Used two ways:
//   1. Automatically on server boot (ensureAdmin) so a fresh deploy is usable.
//   2. Manually via `npm run seed` for local setup / sample data.
import crypto from 'node:crypto';
import { db } from './db.js';
import { createUser } from './auth.js';

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
  ['Kitchen','Snacks','Snacks — chips/crackers','box',6,2,0,0],
  ['Kitchen','Snacks','Snacks — granola/protein bars','box',6,2,0,0],
  ['Kitchen','Snacks','Cookies / sweet snacks','box',4,2,0,0],
  ['Kitchen','Snacks','Fresh fruit','case',3,1,0,0],
  ['Kitchen','Beverages','Bottled water','case',10,3,1,0],
  ['Kitchen','Beverages','Gatorade / electrolyte drinks','case',6,2,1,0],
  ['Kitchen','Beverages','Juice (apple/orange/cranberry)','case',4,2,0,0],
  ['Kitchen','Beverages','Soda (regular + caffeine-free)','case',4,1,0,0],
  ['Kitchen','Beverages','Coffee — regular','bag',6,2,0,0],
  ['Kitchen','Beverages','Coffee — decaf','bag',4,2,0,0],
  ['Kitchen','Beverages','Tea (regular + herbal/decaf)','box',4,1,0,0],
  ['Kitchen','Beverages','Creamer','case',4,1,0,0],
  ['Kitchen','Beverages','Sugar / sweetener packets','box',4,1,0,0],
  ['Kitchen','Beverages','Hot chocolate / electrolyte packets','box',3,1,0,0],
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
  ['Kitchen', 'Hydration & Nutrition', 'Ginger ale', 'case', 4, 1, 0, 0],
  ['Kitchen', 'Hydration & Nutrition', 'Protein boost — chocolate', 'case', 4, 2, 0, 0],
  ['Kitchen', 'Hydration & Nutrition', 'Protein boost — vanilla', 'case', 4, 2, 0, 0],
  ['Kitchen', 'Hydration & Nutrition', 'Protein shakes', 'case', 4, 2, 0, 0],
  ['Kitchen', 'Hydration & Nutrition', 'Jello', 'case', 4, 1, 0, 0],
  ['Kitchen', 'Hydration & Nutrition', 'Yogurt (assorted)', 'case', 4, 1, 0, 1],
  ['Kitchen', 'Hydration & Nutrition', 'Orange juice', 'case', 4, 1, 0, 1],
  ['Kitchen', 'Hydration & Nutrition', 'Milk', 'case', 4, 1, 1, 1],
  // Nurse beverage station
  ['Kitchen', 'Nurse Station', 'Splenda', 'box', 3, 1, 0, 0],
  // Pantry / condiments
  ['Kitchen', 'Pantry', 'Peanut butter', 'jar', 3, 1, 0, 0],
  ['Kitchen', 'Pantry', 'Jelly', 'jar', 3, 1, 0, 0],
  ['Kitchen', 'Pantry', 'Butter', 'case', 3, 1, 0, 1],
  ['Kitchen', 'Pantry', 'Garlic powder', 'each', 2, 1, 0, 0],
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

// Allow `npm run seed` to set up admin + sample data locally.
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAdmin();
  ensureSampleData();
  ensureExampleClient12A();
  ensureInventoryCatalog();
  ensureStaffingStandard();
  console.log('Seed complete.');
}

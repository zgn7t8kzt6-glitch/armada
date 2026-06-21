// Armada Recovery Housing — the sober-living half of the continuum.
//
// This module turns the app into best-in-class recovery-residence software for
// Ohio: NARR / Ohio Recovery Housing (ORH) Level 2 (monitored) and Level 3
// (supervised) homes, run hand-in-glove with Armada's clinical outpatient
// (PHP / IOP / OP). It is grounded in the Excellence Wins (Horst Schulze)
// playbook the org already runs on — warm arrival, anticipation, the fond
// farewell, lateral ownership, measure everything, belonging.
//
// Everything is additive: its own tables (housing_*) and its own /api/housing
// routes, mounted from server.js. It links to the existing `clients` table by
// id so a person can be one record across detox → residential → housing.

import crypto from 'node:crypto';
import { db, audit, getState, setState, appToday, APP_TZ } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { sendEmail, emailConfigured, emailStatus } from './report.js';

/* ───────────────────────── Domain knowledge ───────────────────────── */

// Recovery Capital — the REC-CAP / BARC-10-inspired domains we score 0–10.
// Growth in recovery capital is the single best predictor of staying in
// recovery, so it is the spine of every resident's plan.
export const RECCAP_DOMAINS = [
  ['sobriety',   'Substance use & sobriety',  'Days sober, cravings managed, abstinence confidence'],
  ['health',     'Global health',             'Physical & mental health, sleep, medication adherence'],
  ['support',    'Social support',            'Sober network, family repair, sponsor & peers'],
  ['coping',     'Coping & recovery skills',  'Triggers, relapse-prevention plan, emotion regulation'],
  ['housing',    'Housing stability',         'Safe, stable place to live after this one'],
  ['purpose',    'Meaningful activities',     'Employment, education, volunteering, routine'],
  ['community',  'Citizenship & community',   'Legal, finances, ID/benefits, civic participation'],
  ['commitment', 'Recovery commitment',       'Meeting attendance, service work, identity in recovery'],
];

// House phases — the resident's journey through a residence. Mapped to the
// Three Steps of Service: warm arrival → anticipated stay → fond farewell.
export const PHASES = [
  { n: 1, name: 'Orientation',  days: '0–14',   focus: 'Settle in, learn the house, build rapport, no-shame welcome' },
  { n: 2, name: 'Stabilization',days: '15–45',  focus: 'Routine, clinical engagement, sponsor, first job/volunteer' },
  { n: 3, name: 'Responsibility',days: '46–90', focus: 'Employment, more freedom, mentoring newer residents' },
  { n: 4, name: 'Re-entry',     days: '90+',    focus: 'Transition plan, savings, independent housing, fond farewell' },
];

// Levels of care we coordinate. Weekly clinical-hour targets drive the
// "is this person getting the dose they need?" board. (ASAM/Ohio aligned.)
export const LOC = {
  PHP: { label: 'PHP — Partial Hospitalization', weeklyHours: 20, color: '#c06a52' },
  IOP: { label: 'IOP — Intensive Outpatient',    weeklyHours: 9,  color: '#d29a5e' },
  OP:  { label: 'OP — Outpatient',               weeklyHours: 1,  color: '#5fb0c2' },
  MON: { label: 'Recovery housing only',         weeklyHours: 0,  color: '#a7ba86' },
};

// NARR / Ohio Recovery Housing certification standards, by domain. Level 2 is
// "monitored" (house manager, structure); Level 3 adds "supervised" (paid staff,
// clinical/admin oversight). minLevel = the level at which the item is required.
export const ORH_STANDARDS = [
  // Administrative & Operational
  ['admin', 'A1', 'Mission, recovery-oriented policies & procedures documented', 2],
  ['admin', 'A2', 'Resident agreement / house rules signed at move-in', 2],
  ['admin', 'A3', 'Fee schedule, refund policy & ledger transparent to residents', 2],
  ['admin', 'A4', 'Resident rights & code of ethics posted (NARR Code of Ethics)', 2],
  ['admin', 'A5', 'Grievance & appeal process documented and accessible', 2],
  ['admin', 'A6', 'Insurance, business licensure & ORH membership current', 2],
  ['admin', 'A7', 'Paid, trained staff with defined roles & supervision', 3],
  ['admin', 'A8', 'Staff job descriptions, background checks & training logs', 3],
  // Recovery Support
  ['recovery', 'R1', 'Each resident has an individualized recovery plan', 2],
  ['recovery', 'R2', 'Linkage to clinical care, peer support & community recovery', 2],
  ['recovery', 'R3', 'House meetings held regularly with documented attendance', 2],
  ['recovery', 'R4', 'Drug & alcohol screening policy, applied consistently', 2],
  ['recovery', 'R5', 'MAT-supportive: no resident excluded for prescribed medication', 2],
  ['recovery', 'R6', 'Overdose response: naloxone on site, staff/peers trained', 2],
  ['recovery', 'R7', 'Documented relapse / continued-use response that keeps the door open', 2],
  ['recovery', 'R8', 'Clinical oversight of recovery-support services', 3],
  // Physical Environment
  ['physical', 'P1', 'Home meets local housing, fire & safety codes', 2],
  ['physical', 'P2', 'Working smoke/CO detectors, extinguishers, posted egress plan', 2],
  ['physical', 'P3', 'Clean, furnished, in good repair; adequate space per resident', 2],
  ['physical', 'P4', 'Secure storage for medications & valuables', 2],
  ['physical', 'P5', 'Safe food storage & sanitary kitchen/bath facilities', 2],
  // Good Neighbor & Community
  ['neighbor', 'N1', 'Good-neighbor policy; parking, noise & property maintained', 2],
  ['neighbor', 'N2', 'Resident-to-staff/manager ratio appropriate to the level', 3],
  ['neighbor', 'N3', 'Community relations plan; complaints logged & resolved', 2],
];

// The intake packet — every form a resident fills out on the way in, mapped to
// ORH/NARR standards. Each field: k(ey), l(abel), t(ype), o(ptions). Forms with
// sign:true require a typed e-signature. cat groups them in the UI.
export const FORM_TEMPLATES = [
  { type: 'application', name: 'Admission Application', cat: 'Admission', orh: '', sign: false, fields: [
    { k: 'referral_source', l: 'Referral source', t: 'text' },
    { k: 'clinical_loc', l: 'Clinical level of care', t: 'select', o: ['PHP', 'IOP', 'OP', 'None yet'] },
    { k: 'primary_substance', l: 'Primary substance', t: 'text' },
    { k: 'last_use', l: 'Date of last use', t: 'date' },
    { k: 'mat', l: 'On MAT? (med)', t: 'text' },
    { k: 'legal_status', l: 'Legal status / probation / court', t: 'text' },
    { k: 'insurance', l: 'Insurance / Medicaid #', t: 'text' },
    { k: 'income', l: 'Current income source', t: 'text' },
    { k: 'emergency_name', l: 'Emergency contact name', t: 'text' },
    { k: 'emergency_phone', l: 'Emergency contact phone', t: 'text' },
    { k: 'allergies', l: 'Allergies', t: 'text' },
    { k: 'medical_needs', l: 'Medical / mental-health needs', t: 'textarea' },
  ] },
  { type: 'resident_agreement', name: 'Resident Agreement & House Rules', cat: 'Admission', orh: 'A2', sign: true, fields: [
    { k: 'curfew_ack', l: 'I understand the curfew & overnight policy', t: 'check' },
    { k: 'chores_ack', l: 'I will complete assigned chores & attend house meetings', t: 'check' },
    { k: 'meetings_ack', l: 'I will attend the required recovery meetings per week', t: 'check' },
    { k: 'guests_ack', l: 'I understand the guest & visitation policy', t: 'check' },
    { k: 'zero_tolerance_ack', l: 'I understand the no alcohol/drugs/weapons policy', t: 'check' },
    { k: 'notes', l: 'Notes / exceptions discussed', t: 'textarea' },
  ] },
  { type: 'financial_agreement', name: 'Financial Agreement & Fee Schedule', cat: 'Financial', orh: 'A3', sign: true, fields: [
    { k: 'weekly_fee', l: 'Weekly bed fee ($)', t: 'number' },
    { k: 'due_day', l: 'Rent due day', t: 'select', o: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
    { k: 'deposit', l: 'Deposit / move-in amount ($)', t: 'number' },
    { k: 'source', l: 'How rent will be paid (funding source)', t: 'select', o: ['Self-pay (employment)', 'SOR / STAR scholarship', 'Family support', 'Medicaid (clinical)', 'Mixed / see plan'] },
    { k: 'payment_plan', l: 'Payment plan — how & when they will pay each week', t: 'textarea' },
    { k: 'late_ack', l: 'I understand the late-payment & promise-to-pay process', t: 'check' },
    { k: 'refund_ack', l: 'I have received the refund policy', t: 'check' },
  ] },
  { type: 'roi', name: 'Release of Information (Clinical)', cat: 'Compliance', orh: 'R2', sign: true, fields: [
    { k: 'release_to', l: 'Release to / from', t: 'text' },
    { k: 'purpose', l: 'Purpose of disclosure', t: 'text' },
    { k: 'expires', l: 'Expiration date', t: 'date' },
  ] },
  { type: 'screening_consent', name: 'Drug & Alcohol Screening Consent', cat: 'Compliance', orh: 'R4', sign: true, fields: [
    { k: 'random_ack', l: 'I consent to random & observed drug/alcohol screening', t: 'check' },
    { k: 'positive_ack', l: 'I understand the response to a positive/refused screen', t: 'check' },
  ] },
  { type: 'naloxone_ack', name: 'Overdose Response & Naloxone', cat: 'Compliance', orh: 'R6', sign: true, fields: [
    { k: 'location_ack', l: 'I know where naloxone is kept in the house', t: 'check' },
    { k: 'trained_ack', l: 'I have been shown how to respond to an overdose', t: 'check' },
  ] },
  { type: 'mat_agreement', name: 'MAT Support Agreement', cat: 'Compliance', orh: 'R5', sign: true, fields: [
    { k: 'med', l: 'Prescribed medication (if any)', t: 'text' },
    { k: 'prescriber', l: 'Prescriber / clinic', t: 'text' },
    { k: 'storage_ack', l: 'I will store medication securely as directed', t: 'check' },
  ] },
  { type: 'rights_ack', name: 'Resident Rights & Code of Ethics', cat: 'Compliance', orh: 'A4', sign: true, fields: [
    { k: 'rights_ack', l: 'I received & understand my rights as a resident', t: 'check' },
    { k: 'ethics_ack', l: 'I received the NARR Code of Ethics', t: 'check' },
  ] },
  { type: 'grievance_ack', name: 'Grievance & Appeal Process', cat: 'Compliance', orh: 'A5', sign: true, fields: [
    { k: 'grievance_ack', l: 'I understand how to file a grievance & appeal', t: 'check' },
  ] },
];

export const EMPLOYMENT_STATUSES = ['Employed — full-time', 'Employed — part-time', 'Self-employed', 'Unemployed — actively seeking', 'In school / training', 'Unable to work (disability)', 'Not seeking — early recovery'];
export const JOBSEARCH_ACTIVITIES = ['Application submitted', 'Interview', 'Resume / cover letter', 'Job fair / agency', 'Follow-up call', 'Offer received', 'Hired', 'Lost / left job', 'Orientation / first day'];
export const RENT_STATUSES = ['Paid', 'Partial', 'Promise to pay', 'Scholarship covered', 'Waived', 'Missed'];
export const HOUSING_SHIFTS = ['Day', 'Evening', 'Overnight'];
export const HOUSING_INCIDENT_TYPES = ['Return to use', 'Overdose', 'Medical emergency', 'Behavioral / altercation', 'Property damage', 'Rule violation', 'AWOL / walk-off', 'Theft', 'Self-harm', 'Police / EMS called', 'Successful intervention', 'Other'];

const J = (v) => JSON.stringify(v ?? null);
const P = (v, d = null) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const num = (v, d = 0) => { const n = +v; return Number.isFinite(n) ? n : d; };
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ───────────────────────── Schema ───────────────────────── */

export function housingSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS housing_houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, level TEXT DEFAULT 'L2', orh_cert TEXT,
    address TEXT, city TEXT, gender TEXT DEFAULT 'Any',
    mat_friendly INTEGER DEFAULT 1, capacity INTEGER DEFAULT 0,
    manager TEXT, phone TEXT, opened TEXT, color TEXT, notes TEXT,
    active INTEGER DEFAULT 1, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_beds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, room TEXT, label TEXT,
    status TEXT DEFAULT 'open', resident_id INTEGER, notes TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_residents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, dob TEXT, phone TEXT, email TEXT,
    house_id INTEGER, bed_id INTEGER, client_id INTEGER,
    loc TEXT DEFAULT 'IOP', phase INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active', move_in TEXT, discharge_date TEXT, discharge_type TEXT,
    sober_date TEXT, recovery_coach TEXT, payer TEXT, insurance TEXT,
    employment TEXT, education TEXT, mat TEXT, sponsor TEXT, home_group TEXT,
    emergency_name TEXT, emergency_phone TEXT, goals TEXT, notes TEXT,
    photo TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_reccap (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, scores TEXT, total REAL, note TEXT, by TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_supports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, type TEXT, detail TEXT, by TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_screens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, panel TEXT, observed INTEGER DEFAULT 0,
    result TEXT DEFAULT 'pending', substances TEXT, scheduled INTEGER DEFAULT 0,
    collected_by TEXT, note TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_chorelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, resident_id INTEGER, chore TEXT, date TEXT,
    done INTEGER DEFAULT 0, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_curfew (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, resident_id INTEGER, date TEXT,
    status TEXT, time TEXT, by TEXT, note TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, house_id INTEGER, date TEXT, kind TEXT,
    present INTEGER DEFAULT 1, topic TEXT, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, kind TEXT, amount REAL,
    payer TEXT, memo TEXT, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_coordination (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, week TEXT, hours REAL DEFAULT 0,
    kind TEXT, note TEXT, with_clinical INTEGER DEFAULT 0, roi INTEGER DEFAULT 0,
    by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_orh (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, code TEXT, status TEXT DEFAULT 'gap',
    note TEXT, updated_by TEXT, updated TEXT
  );
  CREATE TABLE IF NOT EXISTS housing_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, date TEXT, type TEXT, result TEXT, note TEXT, by TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_grievances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, resident_id INTEGER, date TEXT, summary TEXT,
    status TEXT DEFAULT 'open', resolution TEXT, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, resident_id INTEGER, date TEXT, type TEXT, severity TEXT,
    summary TEXT, action TEXT, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, type TEXT, status TEXT DEFAULT 'not_started',
    data TEXT, signed_by TEXT, signed_date TEXT, staff TEXT,
    created TEXT DEFAULT (datetime('now')), updated TEXT
  );
  CREATE TABLE IF NOT EXISTS housing_payplans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, weekly_amount REAL DEFAULT 0, due_day TEXT, source TEXT,
    arrangement TEXT, deposit REAL DEFAULT 0, start_date TEXT, active INTEGER DEFAULT 1,
    by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_rentlog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, week TEXT, due REAL DEFAULT 0, collected REAL DEFAULT 0,
    status TEXT, promise_date TEXT, note TEXT, by TEXT, date TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_employment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, status TEXT, employer TEXT, position TEXT, wage TEXT,
    hours TEXT, goal TEXT, weekly_target INTEGER DEFAULT 5, note TEXT, by TEXT,
    date TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_jobsearch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, activity TEXT, employer TEXT, detail TEXT,
    outcome TEXT, by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_staff_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, date TEXT, shift TEXT, user_id INTEGER, staff_name TEXT,
    role TEXT, status TEXT DEFAULT 'scheduled', note TEXT, by TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_shift_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, date TEXT, shift TEXT, on_duty TEXT,
    present_count INTEGER, expected_count INTEGER, out_residents TEXT,
    meds_note TEXT, safety TEXT, summary TEXT, handoff TEXT, escalation INTEGER DEFAULT 0,
    by TEXT, created TEXT DEFAULT (datetime('now'))
  );
  -- Sober Living resident kiosk: a separate kiosk (own code) whose results live
  -- entirely under Recovery Housing, walled off from the clinical/detox side.
  CREATE TABLE IF NOT EXISTS housing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, date TEXT, mood INTEGER, cravings INTEGER,
    meeting INTEGER, slept_ok INTEGER, need TEXT, note TEXT,
    seen INTEGER DEFAULT 0, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, category TEXT, text TEXT, priority TEXT DEFAULT 'Normal',
    status TEXT DEFAULT 'open', handled_by TEXT, handled_at TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, text TEXT, status TEXT DEFAULT 'open',
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT, title TEXT, description TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS housing_survey_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER, category TEXT, text TEXT, type TEXT DEFAULT 'scale', sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS housing_survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER, resident_id INTEGER, created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_survey_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    response_id INTEGER, question_id INTEGER, value_num REAL, value_text TEXT
  );
  -- Restrictions: new-resident blackout, behavioral/privilege holds, etc., with
  -- the criteria for coming off so staff can see who qualifies to be lifted.
  CREATE TABLE IF NOT EXISTS housing_restrictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resident_id INTEGER, type TEXT, reason TEXT,
    start_date TEXT, days INTEGER, end_date TEXT, conditions TEXT,
    status TEXT DEFAULT 'active', placed_by TEXT,
    lifted_by TEXT, lifted_at TEXT, lift_note TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  -- Maintenance work orders per house.
  CREATE TABLE IF NOT EXISTS housing_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, area TEXT, title TEXT, detail TEXT,
    priority TEXT DEFAULT 'Normal', status TEXT DEFAULT 'open',
    assigned_to TEXT, reported_by TEXT, cost REAL,
    resolution TEXT, resolved_at TEXT, created TEXT DEFAULT (datetime('now'))
  );
  -- Inventory: stock items with a par (reorder point) so we know what's low.
  CREATE TABLE IF NOT EXISTS housing_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER, name TEXT, category TEXT, unit TEXT DEFAULT 'each',
    qty REAL DEFAULT 0, par REAL DEFAULT 0, reorder_qty REAL DEFAULT 0,
    vendor TEXT, sku TEXT, unit_cost REAL DEFAULT 0, auto INTEGER DEFAULT 1,
    updated TEXT DEFAULT (datetime('now')), created TEXT DEFAULT (datetime('now'))
  );
  -- Reorder/purchase orders + their lines.
  CREATE TABLE IF NOT EXISTS housing_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT, status TEXT DEFAULT 'suggested', total REAL DEFAULT 0,
    note TEXT, by TEXT, ordered_at TEXT, received_at TEXT,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER, item_id INTEGER, name TEXT, qty REAL, unit_cost REAL DEFAULT 0
  );
  `);
  // Migration: program (PHP / IOP / Graduate) per house, added after first ship.
  try { db.exec(`ALTER TABLE housing_houses ADD COLUMN program TEXT`); } catch { /* already exists */ }
  // Migration: richer incident reports.
  for (const col of ['time TEXT', 'status TEXT', 'notified TEXT', 'reported_by TEXT', 'follow_up TEXT']) {
    try { db.exec(`ALTER TABLE housing_incidents ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  // Migration: photo consent attestation (who/when).
  try { db.exec(`ALTER TABLE housing_residents ADD COLUMN photo_consent TEXT`); } catch { /* already exists */ }
}

/* ───────────────────────── Seed (sample so it looks alive) ───────────────────────── */

// The real Armada recovery-housing roster (from the weekly occupancy email).
// Beds are generated per location; current census occupancy is reflected by
// marking that many beds occupied (name pending — assigned at real intake).
const REAL_HOUSES = [
  // name, gender, program, level, totalBeds, occupied, overflow, note
  ['Coventry',    'Men',   'PHP',      'L3', 44, 36, 0, ''],
  ['High St',     'Women', 'PHP',      'L3', 10,  9, 2, '2 overflow beds available'],
  ['Perkins',     'Women', 'PHP',      'L3', 10,  5, 0, 'Pause on filling until girls can move from High St'],
  ['Long St',     'Women', 'IOP',      'L2',  5,  5, 0, ''],
  ['Mildred',     'Men',   'IOP',      'L2',  7,  5, 0, ''],
  ['12th St SW',  'Men',   'IOP',      'L2',  9,  5, 0, ''],
  ['Raasch',      'Men',   'IOP',      'L2',  5,  4, 0, ''],
  ['27th St SW',  'Women', 'IOP',      'L2',  5,  3, 0, ''],
  ['18th St SW',  'Men',   'IOP',      'L2',  5,  5, 0, ''],
  ['Wilbeth',     'Men',   'Graduate', 'L2',  5,  4, 0, "Men's graduate house"],
];
const PROGRAM_COLOR = { PHP: '#235056', IOP: '#5fb0c2', Graduate: '#a7ba86' };

export function seedHousing() {
  const has = db.prepare(`SELECT COUNT(*) c FROM housing_houses`).get().c;
  if (has) return 0;

  const mkHouse = db.prepare(`INSERT INTO housing_houses (name,level,gender,program,mat_friendly,capacity,color,notes)
    VALUES (?,?,?,?,?,?,?,?)`);
  const mkBed = db.prepare(`INSERT INTO housing_beds (house_id,room,label,status,notes) VALUES (?,?,?,?,?)`);

  REAL_HOUSES.forEach(([name, gender, program, level, total, occupied, overflow, note]) => {
    const hid = Number(mkHouse.run(name, level, gender, program, 1, total, PROGRAM_COLOR[program] || '#235056', note).lastInsertRowid);
    // standard beds — first `occupied` are filled (census), the rest open
    for (let i = 1; i <= total; i++) {
      const filled = i <= occupied;
      mkBed.run(hid, String(Math.ceil(i / 2)), 'B' + i, filled ? 'occupied' : 'open', filled ? 'Census occupant — assign resident at intake' : null);
    }
    // overflow beds (extra capacity beyond the standard count)
    for (let o = 1; o <= (overflow || 0); o++) mkBed.run(hid, 'OF', 'OF' + o, 'open', 'Overflow bed');
  });

  // ORH/NARR status + inspections per house (mostly met; a few gaps to work)
  const houseIds = db.prepare(`SELECT id, level FROM housing_houses`).all();
  const mkOrh = db.prepare(`INSERT INTO housing_orh (house_id,code,status,updated_by,updated) VALUES (?,?,?,?,?)`);
  const mkIns = db.prepare(`INSERT INTO housing_inspections (house_id,date,type,result,note,by) VALUES (?,?,?,?,?,?)`);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  houseIds.forEach((h, i) => {
    const lvl = h.level === 'L3' ? 3 : 2;
    ORH_STANDARDS.forEach((stx, j) => {
      if (stx[3] > lvl) return;
      const status = (j % 9 === 0) ? 'partial' : (j % 13 === 0 ? 'gap' : 'met');
      mkOrh.run(h.id, stx[1], status, 'system', daysAgo(14));
    });
    mkIns.run(h.id, daysAgo(35), 'Fire & safety', 'Pass', 'Annual fire inspection — detectors & extinguishers OK', 'system');
    mkIns.run(h.id, daysAgo(8), 'House walkthrough', 'Pass', 'Monthly walkthrough — clean, in good repair', 'system');
  });

  return houseIds.length;
}

// Tables wiped + reloaded when the real roster is (re)applied to an existing DB.
const HOUSING_TABLES = ['housing_beds','housing_residents','housing_reccap','housing_supports','housing_screens','housing_chorelog','housing_curfew','housing_meetings','housing_ledger','housing_coordination','housing_orh','housing_inspections','housing_grievances','housing_incidents','housing_forms','housing_payplans','housing_rentlog','housing_employment','housing_jobsearch','housing_houses'];

/* ───────────────────────── Akron patient-export import ───────────────────────── */
// The weekly Kipu/patient export ("download patients") carries every site —
// Akron AND Dayton. Per the owner: EXCLUDE Dayton, and tie residents ONLY to the
// 10 Akron houses already in the system, mapping each person to a house by their
// `room` / `facility`. Current residents are seated in open beds; the rest can
// optionally come in as alumni (discharged) for history. No PHI is stored in the
// repo — the file is uploaded into the running app and parsed server-side.

const DAYTON_RE = /dayton|lansing|cherrywood|smithsville|adalbert/i;
const JUNK_RE = /chore|checklist|duplicate file|training/i;

// CSV → rows[][], handling quoted fields, escaped quotes, and CRLF/LF.
function parseCsv(text) {
  const s = String(text).replace(/\r\n?/g, '\n');
  // Auto-detect the delimiter from the header line: pasting from a spreadsheet
  // often yields tab-separated values rather than commas.
  const head = s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'));
  const delim = (head.split('\t').length > head.split(',').length) ? '\t' : ',';
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const cleanCell = (v) => {
  const s = String(v ?? '').trim();
  return (s === '' || s === '--' || s === '-' || /^\[no name\]$/i.test(s)) ? '' : s;
};
// "MM/DD/YYYY" → "YYYY-MM-DD" (blank / -- → null)
function usDate(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

// Map a row's room + facility to one of our 10 Akron house names (null = not ours).
function houseFromRoom(room, facility) {
  const r = cleanCell(room);
  const f = String(facility || '').trim();
  // Coventry IS the Glenmount building; its rooms are 4-digit numbers (2189, 2201…).
  if (/glenmount/i.test(f)) return 'Coventry';
  if (/^\d{3,4}$/.test(r)) return 'Coventry';
  const probe = `${r} ${f}`.toLowerCase();
  if (/wilbeth/.test(probe))   return 'Wilbeth';
  if (/mildred/.test(probe))   return 'Mildred';
  if (/12th/.test(probe))      return '12th St SW';
  if (/18th/.test(probe))      return '18th St SW';
  if (/27th/.test(probe))      return '27th St SW';
  if (/raasch/.test(probe))    return 'Raasch';
  if (/long/.test(probe))      return 'Long St';
  if (/high\s*st/.test(probe)) return 'High St';
  if (/perkins/.test(probe))   return 'Perkins';
  return null;
}

const programToLoc = (p) => (p === 'PHP' ? 'PHP' : (p === 'Graduate' ? 'MON' : 'IOP'));

// Restriction types and how each is typically cleared (shown to staff as guidance).
const RESTRICTION_TYPES = [
  ['New-resident blackout', 14, 'No outside passes; phone limits; escorted outings. Standard intake stabilization.'],
  ['Behavioral restriction', 7, 'Imposed after a rule violation; off when conditions are met.'],
  ['Privilege / phase hold', 7, 'Privileges paused; restored on review.'],
  ['Curfew restriction', 7, 'Earlier curfew / sign-in required.'],
  ['Medical / safety hold', 0, 'Cleared by staff when medically/behaviorally safe.'],
];
// The active restriction for a resident (most recent still-active one), with the
// computed "eligible to lift" signal: the time window has elapsed.
function currentRestriction(rid) {
  const r = db.prepare(`SELECT * FROM housing_restrictions WHERE resident_id=? AND status='active' ORDER BY id DESC LIMIT 1`).get(rid);
  if (!r) return null;
  const today = todayStr();
  let eligible = false, daysLeft = null;
  if (r.end_date) { eligible = today >= r.end_date; daysLeft = Math.max(0, Math.round((new Date(r.end_date) - new Date(today)) / 86400000)); }
  else if (r.days && r.start_date) { const done = Math.round((new Date(today) - new Date(r.start_date)) / 86400000); daysLeft = Math.max(0, r.days - done); eligible = done >= r.days; }
  else eligible = true; // open-ended (e.g. medical) — staff decide, so always reviewable
  return { ...r, eligible, daysLeft };
}

// If raw HTML-table markup is pasted (copying from the data shown as a web
// page), flatten <tr>/<td> into tab-separated rows before parsing.
function htmlTableToText(html) {
  const dec = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
  const trs = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  return trs.map(tr => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(dec).join('\t')).join('\n');
}

// Parse + load. opts.includeAlumni also brings Past residents in as discharged.
export function importAkronCsv(csvText, opts = {}, user = { name: 'system' }) {
  const includeAlumni = !!opts.includeAlumni;
  if (/<tr[\s>]/i.test(String(csvText))) csvText = htmlTableToText(String(csvText));
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { error: 'That file looks empty.' };
  const hdr = rows[0].map(h => h.trim().toLowerCase());
  const ix = (n) => hdr.indexOf(n);
  const C = {
    first: ix('first_name'), middle: ix('middle_name'), last: ix('last_name'),
    email: ix('email'), phone: ix('phone'), status: ix('status'), categories: ix('categories'),
    room: ix('room'), dob: ix('birthdate'), facility: ix('facility'),
    admitted: ix('admitted_at'), discharged: ix('discharged_at'), reason: ix('reason_for_discharge'),
    employment: ix('employment'), insurance: ix('insurance_name'), sober: ix('latest_sobriety_date'),
  };
  if (C.first < 0 || C.last < 0 || C.facility < 0) return { error: 'Unexpected columns — is this the patient export CSV?' };

  const houseByName = {};
  db.prepare(`SELECT id,name,program,gender FROM housing_houses`).all().forEach(h => { houseByName[h.name] = h; });
  const findOpenBed = db.prepare(`SELECT id FROM housing_beds WHERE house_id=? AND status='open' ORDER BY id LIMIT 1`);
  const fillBed = db.prepare(`UPDATE housing_beds SET status='occupied', resident_id=?, notes=NULL WHERE id=?`);
  const existsResident = db.prepare(`SELECT id FROM housing_residents WHERE lower(name)=? AND IFNULL(dob,'')=? LIMIT 1`);
  const insResident = db.prepare(`INSERT INTO housing_residents
    (name,dob,phone,email,house_id,bed_id,loc,status,move_in,discharge_date,discharge_type,sober_date,employment,insurance,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Free placeholder census seats (resident_id NULL) so real people take them.
  const clearedBeds = db.prepare(`UPDATE housing_beds SET status='open', notes=NULL WHERE resident_id IS NULL AND status='occupied'`).run().changes;

  const stat = { imported: 0, alumni: 0, placed: 0, dayton: 0, junk: 0, dups: 0, noHouse: 0 };
  db.exec('BEGIN');
  try {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;
      const g = (k) => (C[k] >= 0 ? (row[C[k]] ?? '') : '');
      const facility = String(g('facility')).trim();
      if (DAYTON_RE.test(facility)) { stat.dayton++; continue; }
      if (JUNK_RE.test(facility) || JUNK_RE.test(String(g('categories')))) { stat.junk++; continue; }

      const name = [cleanCell(g('first')), cleanCell(g('middle')), cleanCell(g('last'))]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (!name || /no name/i.test(name)) { stat.junk++; continue; }

      const isCurrent = String(g('status')).trim().toLowerCase() === 'current';
      if (!isCurrent && !includeAlumni) continue;

      const houseName = houseFromRoom(g('room'), facility);
      const h = houseName && houseByName[houseName];
      if (!h) { stat.noHouse++; continue; }

      const dob = usDate(g('dob'));
      if (existsResident.get(name.toLowerCase(), dob || '')) { stat.dups++; continue; }

      let bedId = null, status = 'discharged';
      if (isCurrent) {
        status = 'active';
        const bed = findOpenBed.get(h.id);
        if (bed) { bedId = bed.id; stat.placed++; }
      }
      const rid = Number(insResident.run(
        name, dob, cleanCell(g('phone')) || null, cleanCell(g('email')) || null,
        h.id, bedId, programToLoc(h.program), status,
        usDate(g('admitted')),
        isCurrent ? null : usDate(g('discharged')),
        isCurrent ? null : (cleanCell(g('reason')) || 'Discharged'),
        usDate(g('sober')),
        cleanCell(g('employment')) || null, cleanCell(g('insurance')) || null,
        `Imported from Akron patient export ${todayStr()}`,
      ).lastInsertRowid);
      if (bedId) fillBed.run(rid, bedId);
      if (isCurrent) stat.imported++; else stat.alumni++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit({ user, action: 'HOUSING_CSV_IMPORT', detail: `current=${stat.imported} alumni=${stat.alumni} placed=${stat.placed} dayton=${stat.dayton} junk=${stat.junk} dups=${stat.dups} noHouse=${stat.noHouse}` });
  return { ok: true, clearedBeds, ...stat };
}

/* ───────────────────────── Helpers ───────────────────────── */

const occMap = () => {
  const rows = db.prepare(`SELECT house_id, status, COUNT(*) c FROM housing_beds GROUP BY house_id, status`).all();
  const m = {};
  for (const r of rows) { m[r.house_id] = m[r.house_id] || { open: 0, occupied: 0, hold: 0, maintenance: 0 }; m[r.house_id][r.status] = r.c; }
  return m;
};

const latestCap = (rid) => db.prepare(`SELECT * FROM housing_reccap WHERE resident_id=? ORDER BY date DESC, id DESC LIMIT 1`).get(rid);
const balanceOf = (rid) => {
  const r = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind='charge' THEN amount WHEN kind='adjustment' THEN amount ELSE 0 END),0) charges,
      COALESCE(SUM(CASE WHEN kind='payment' THEN amount ELSE 0 END),0) paid
    FROM housing_ledger WHERE resident_id=?`).get(rid);
  return +(r.charges - r.paid).toFixed(2);
};
const losDays = (moveIn) => { if (!moveIn) return 0; return Math.max(0, Math.round((Date.now() - new Date(moveIn).getTime()) / 86400000)); };
const soberDays = (d) => { if (!d) return 0; return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 86400000)); };
const weekKey = (d = todayStr()) => { const dt = new Date(d); dt.setDate(dt.getDate() - dt.getDay()); return dt.toISOString().slice(0, 10); };
const meetingsThisWeek = (rid) => db.prepare(`SELECT COUNT(*) c FROM housing_supports WHERE resident_id=? AND type='meeting' AND date>=?`).get(rid, weekKey()).c;
const clinHoursThisWeek = (rid) => db.prepare(`SELECT COALESCE(SUM(hours),0) h FROM housing_coordination WHERE resident_id=? AND week=?`).get(rid, weekKey()).h;
const lastScreen = (rid) => db.prepare(`SELECT * FROM housing_screens WHERE resident_id=? ORDER BY date DESC, id DESC LIMIT 1`).get(rid);
const currentPayplan = (rid) => db.prepare(`SELECT * FROM housing_payplans WHERE resident_id=? AND active=1 ORDER BY id DESC LIMIT 1`).get(rid);
const currentEmployment = (rid) => db.prepare(`SELECT * FROM housing_employment WHERE resident_id=? ORDER BY date DESC, id DESC LIMIT 1`).get(rid);
const jobsearchThisWeek = (rid) => db.prepare(`SELECT COUNT(*) c FROM housing_jobsearch WHERE resident_id=? AND date>=?`).get(rid, weekKey()).c;
function packetStatus(rid) {
  const total = FORM_TEMPLATES.length;
  const rows = db.prepare(`SELECT type, status FROM housing_forms WHERE resident_id=?`).all(rid);
  const m = {}; rows.forEach(r => m[r.type] = r.status);
  const done = FORM_TEMPLATES.filter(t => m[t.type] === 'complete').length;
  return { done, total, pct: Math.round(done / total * 100), map: m };
}

function residentCard(r) {
  const cap = latestCap(r.id);
  const { photo, ...rest } = r; // keep the base64 blob out of list/detail payloads
  return {
    ...rest,
    hasPhoto: !!photo,
    los: losDays(r.move_in),
    soberDays: soberDays(r.sober_date),
    balance: balanceOf(r.id),
    reccap: cap ? cap.total : null,
    meetingsWk: meetingsThisWeek(r.id),
    clinHoursWk: clinHoursThisWeek(r.id),
    clinTarget: LOC[r.loc]?.weeklyHours || 0,
    lastScreen: lastScreen(r.id),
    packet: packetStatus(r.id),
    payplan: currentPayplan(r.id) || null,
    restriction: currentRestriction(r.id),
    employment_status: (currentEmployment(r.id)?.status) || null,
    jobSearchWk: jobsearchThisWeek(r.id),
    house: r.house_id ? (db.prepare(`SELECT name,level,color FROM housing_houses WHERE id=?`).get(r.house_id) || null) : null,
    bed: r.bed_id ? (db.prepare(`SELECT room,label FROM housing_beds WHERE id=?`).get(r.bed_id) || null) : null,
  };
}

/* ───────────────────────── Routes ───────────────────────── */

// Recovery Housing is walled off from the clinical/detox side: only the
// owner/admin, the Executive Director, and housing staff may touch any of it.
const HOUSING_ACCESS_ROLES = ['Housing Director', 'House Manager', 'Recovery Coach'];
function requireHousing(req, res, next) {
  const u = req.user;
  if (u && (u.role === 'admin' || u.job_role === 'Executive Director' || HOUSING_ACCESS_ROLES.includes(u.job_role))) return next();
  return res.status(403).json({ error: 'Hilltop Recovery Home is restricted to housing staff.' });
}

/* ───────────────── Sober Living resident kiosk (its own code) ───────────────── */
// Two separate companies: the SL kiosk is a distinct device experience with its
// own access code; everything it collects stays inside Recovery Housing.
const SL_REQUEST_CATEGORIES = ['House manager', 'Recovery coach', 'Maintenance / repair', 'Transportation', 'Medication / MAT', 'Supplies', 'Something else'];
const SL_DISTRESS = /\b(leave|leaving|relapse|use|using|drink|drank|high|crav(e|ing)|want out|give up|hurt myself|kill myself|suicid|hopeless|panic|can'?t breathe|withdraw|sick|unsafe|threat)\b/i;

function slKioskCode() { return getState('sl_kiosk_code') || process.env.SL_KIOSK_CODE || process.env.HOUSING_KIOSK_CODE || 'soberliving'; }
function slKioskCodeWeak() { const c = slKioskCode(); return !c || c.toLowerCase() === 'soberliving' || c.length < 6; }
function slSecret() { let s = getState('sl_kiosk_secret'); if (!s) { s = crypto.randomBytes(32).toString('hex'); setState('sl_kiosk_secret', s); } return s; }
function slSign() { const exp = Date.now() + 12 * 3600e3; const sig = crypto.createHmac('sha256', slSecret()).update(String(exp)).digest('hex').slice(0, 32); return `${exp}.${sig}`; }
function slVerify(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const [e, sig] = tok.split('.'); const exp = +e;
  if (!exp || exp < Date.now()) return false;
  const want = crypto.createHmac('sha256', slSecret()).update(String(exp)).digest('hex').slice(0, 32);
  try { return crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(want)); } catch { return false; }
}
function slCodeValid(req) {
  const got = String(req.query.code || req.body?.code || ''), want = String(slKioskCode());
  if (!got || got.length !== want.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}
const _slFails = new Map();
function requireSlKiosk(req, res, next) {
  if (slVerify(req.cookies?.slKioskToken)) return next();
  const k = req.ip || 'x'; const f = _slFails.get(k);
  if (f && f.n >= 15 && Date.now() - f.t < 6e5) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
  if (slCodeValid(req)) {
    _slFails.delete(k);
    res.cookie('slKioskToken', slSign(), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: new Date(Date.now() + 12 * 3600e3) });
    return next();
  }
  _slFails.set(k, { n: (f && Date.now() - f.t < 6e5 ? f.n : 0) + 1, t: Date.now() });
  return res.status(401).json({ error: 'Invalid kiosk code' });
}
// Kiosk-safe display name: first name + last initial (never the full legal name).
function slPrefName(name) {
  const p = String(name || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || 'Resident');
}
// One built-in weekly pulse, seeded once so the kiosk has a survey out of the box.
function seedHousingSurveys() {
  if (db.prepare(`SELECT COUNT(*) c FROM housing_surveys`).get().c) return;
  const sid = Number(db.prepare(`INSERT INTO housing_surveys (key,title,description,sort) VALUES ('pulse','Weekly recovery check-in','A few quick questions about how this week has gone.',1)`).run().lastInsertRowid);
  const q = db.prepare(`INSERT INTO housing_survey_questions (survey_id,category,text,type,sort) VALUES (?,?,?,?,?)`);
  [
    ['How you feel here', 'I feel safe and supported in my house', 'scale'],
    ['How you feel here', 'Staff treat me with dignity and respect', 'scale'],
    ['Recovery', 'I am connected to a recovery community (meetings, sponsor, peers)', 'scale'],
    ['Recovery', 'I am making progress toward my goals', 'scale'],
    ['Recovery', 'I would recommend Armada sober living to a friend in recovery', 'scale'],
    ['Your words', 'What is going well, or what would make your stay better?', 'text'],
  ].forEach((row, i) => q.run(sid, row[0], row[1], row[2], i));
}

const MAINT_AREAS = ['Plumbing', 'Electrical', 'HVAC / heating', 'Appliance', 'Furniture', 'Doors / locks / keys', 'Pest control', 'Safety (smoke/CO/extinguisher)', 'Cleaning / janitorial', 'Grounds / exterior', 'Other'];
const SUPPLY_CATEGORIES = ['Household', 'Cleaning', 'Paper goods', 'Kitchen / food', 'Toiletries', 'Safety', 'Drug screens / medical', 'Office', 'Bedding', 'Other'];
// A sensible starter stock list (central = no specific house) so automated
// reordering works out of the box; quantities start at 0 so everything reads low
// until staff do a first count.
function seedHousingSupplies() {
  if (db.prepare(`SELECT COUNT(*) c FROM housing_inventory`).get().c) return;
  const ins = db.prepare(`INSERT INTO housing_inventory (house_id,name,category,unit,qty,par,reorder_qty,unit_cost) VALUES (NULL,?,?,?,0,?,?,?)`);
  [
    ['Toilet paper', 'Paper goods', 'case', 4, 6, 28], ['Paper towels', 'Paper goods', 'case', 3, 4, 24],
    ['Trash bags (kitchen)', 'Cleaning', 'box', 4, 6, 12], ['Trash bags (lawn)', 'Cleaning', 'box', 2, 3, 14],
    ['Laundry detergent', 'Cleaning', 'jug', 4, 6, 13], ['Dish soap', 'Cleaning', 'bottle', 4, 6, 4],
    ['All-purpose cleaner', 'Cleaning', 'bottle', 4, 6, 5], ['Bleach', 'Cleaning', 'jug', 3, 4, 4],
    ['Disinfectant wipes', 'Cleaning', 'canister', 6, 8, 5], ['Hand soap', 'Toiletries', 'bottle', 6, 8, 3],
    ['Shampoo / body wash', 'Toiletries', 'bottle', 6, 8, 4], ['Toothpaste', 'Toiletries', 'tube', 8, 12, 2],
    ['Toothbrush', 'Toiletries', 'each', 10, 20, 1], ['Razors', 'Toiletries', 'pack', 6, 10, 6],
    ['Coffee', 'Kitchen / food', 'can', 6, 8, 9], ['Sugar', 'Kitchen / food', 'bag', 3, 4, 4],
    ['Creamer', 'Kitchen / food', 'tub', 4, 6, 5], ['Paper plates', 'Paper goods', 'pack', 4, 6, 7],
    ['Plastic cutlery', 'Paper goods', 'pack', 4, 6, 6], ['Drug screen cups (12-panel)', 'Drug screens / medical', 'box', 2, 4, 90],
    ['Breathalyzer mouthpieces', 'Drug screens / medical', 'pack', 2, 3, 15], ['Nitrile gloves', 'Safety', 'box', 4, 6, 9],
    ['Naloxone (Narcan)', 'Safety', 'box', 4, 6, 0], ['Smoke detector batteries (9V)', 'Safety', 'pack', 4, 6, 12],
    ['First-aid kit refill', 'Safety', 'kit', 2, 3, 25], ['Light bulbs (LED)', 'Household', 'pack', 4, 6, 10],
    ['Bed sheets (twin set)', 'Bedding', 'set', 6, 10, 18], ['Pillows', 'Bedding', 'each', 6, 10, 8],
    ['Towels', 'Bedding', 'each', 10, 16, 6], ['Printer paper', 'Office', 'ream', 3, 4, 6],
  ].forEach(r => ins.run(r[0], r[1], r[2], r[3], r[4], r[5]));
}
// Low = at or below par. Used for the reorder suggestion.
const isLow = (it) => (it.qty ?? 0) <= (it.par ?? 0);

/* ───────────── Branded email shell (mobile-first, email-client-safe) ───────────── */
const SL_BRAND = 'Hilltop Recovery Home';
const EM = { ink: '#1f2d2b', teal: '#235056', teal2: '#2d6b6b', sage: '#7d9b6a', sageBg: '#eef3e8', line: '#e2e8df', soft: '#6b7b78', paper: '#ffffff', wash: '#f4f7f3', red: '#b3382f', redBg: '#fbeceb', gold: '#bf8f3a' };
function emailShell({ title, subtitle, accent = EM.teal, body }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${EM.wash}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EM.wash};padding:18px 12px">
   <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${EM.paper};border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(20,40,38,.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${EM.ink}">
      <tr><td style="background:${accent};padding:22px 26px">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.72);font-weight:600">⛰ ${SL_BRAND}</div>
        <div style="font-size:23px;font-weight:700;color:#fff;margin-top:4px">${title}</div>
        ${subtitle ? `<div style="font-size:14px;color:rgba(255,255,255,.85);margin-top:3px">${subtitle}</div>` : ''}
      </td></tr>
      <tr><td style="padding:24px 26px">${body}</td></tr>
      <tr><td style="padding:14px 26px 24px"><div style="border-top:1px solid ${EM.line};padding-top:14px;font-size:12px;color:${EM.soft}">${SL_BRAND} · automated report from Armada. You're receiving this as clinical / leadership.</div></td></tr>
    </table>
   </td></tr>
  </table></body></html>`;
}
// KPI cards as a wrap-friendly grid (2-up on phones via inline-block cells).
function emailKpis(cards) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>` +
    cards.map(c => `<div style="display:inline-block;width:30%;min-width:90px;vertical-align:top;background:${c.bg || EM.wash};border:1px solid ${EM.line};border-radius:12px;padding:12px 8px;margin:0 1% 8px 0;text-align:center">
      <div style="font-size:27px;font-weight:800;color:${c.color || EM.teal};line-height:1">${c.n}</div>
      <div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:${EM.soft};margin-top:4px">${c.label}</div></div>`).join('') +
    `</td></tr></table>`;
}
function emailSection(title, count, color = EM.teal) {
  return `<div style="margin:20px 0 8px;padding-bottom:6px;border-bottom:2px solid ${EM.sageBg}">
    <span style="font-size:16px;font-weight:700;color:${color}">${title}</span>${count != null ? `<span style="font-size:14px;color:${EM.soft};font-weight:600"> · ${count}</span>` : ''}</div>`;
}
function emailList(arr, fmt) {
  if (!arr.length) return `<div style="color:${EM.soft};font-size:14px;font-style:italic">None.</div>`;
  return arr.map(x => `<div style="font-size:15px;padding:7px 0;border-bottom:1px solid ${EM.wash}">${fmt(x)}</div>`).join('');
}

/* ───────────── Daily Movement report (auto-emailed to clinical + leadership) ───────────── */
// One dated snapshot of the houses: who came in, who left, and where the census
// stands — the morning number clinical and leadership want.
export function buildDailyMovement(date) {
  date = date || appToday();
  const intakes = db.prepare(`SELECT r.name, r.loc, h.name house FROM housing_residents r LEFT JOIN housing_houses h ON h.id=r.house_id WHERE r.move_in=? ORDER BY h.name, r.name`).all(date);
  const discharges = db.prepare(`SELECT r.name, r.discharge_type, h.name house FROM housing_residents r LEFT JOIN housing_houses h ON h.id=r.house_id WHERE r.discharge_date=? ORDER BY r.name`).all(date);
  const occ = occMap();
  const houses = db.prepare(`SELECT * FROM housing_houses WHERE active=1 ORDER BY program, name`).all();
  const capacity = houses.reduce((a, h) => a + (h.capacity || 0), 0);
  const occupied = Object.values(occ).reduce((a, o) => a + (o.occupied || 0), 0);
  const open = Object.values(occ).reduce((a, o) => a + (o.open || 0), 0);
  const census = db.prepare(`SELECT COUNT(*) c FROM housing_residents WHERE status='active'`).get().c;
  const byHouse = houses.map(h => { const o = occ[h.id] || {}; return { name: h.name, program: h.program || '', occupied: o.occupied || 0, capacity: h.capacity || 0, open: o.open || 0 }; });
  const byProgram = {};
  for (const h of houses) { const o = occ[h.id] || {}; byProgram[h.program || 'Other'] = (byProgram[h.program || 'Other'] || 0) + (o.occupied || 0); }
  const occPct = capacity ? Math.round(occupied / capacity * 100) : 0;
  // Operational signals leadership/clinical want alongside the census.
  const incidents = db.prepare(`SELECT i.type, i.severity, i.summary, h.name house FROM housing_incidents i LEFT JOIN housing_houses h ON h.id=i.house_id WHERE i.date=? ORDER BY i.id DESC`).all(date);
  const openWO = db.prepare(`SELECT COUNT(*) c FROM housing_maintenance WHERE status!='done'`).get().c;
  const urgentWO = db.prepare(`SELECT m.title, h.name house FROM housing_maintenance m LEFT JOIN housing_houses h ON h.id=m.house_id WHERE m.status!='done' AND m.priority='Urgent' ORDER BY m.id DESC`).all();
  const lowStock = db.prepare(`SELECT COUNT(*) c FROM housing_inventory WHERE qty<=par`).get().c;
  const kpis = { date, intakes: intakes.length, discharges: discharges.length, census, occupied, capacity, open, occPct, openWO, lowStock, incidents: incidents.length };

  const pretty = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const body = `
    ${emailKpis([
    { n: census, label: 'Census', color: EM.teal },
    { n: '+' + intakes.length, label: 'Intakes', color: EM.sage },
    { n: '−' + discharges.length, label: 'Discharges', color: EM.gold },
    { n: open, label: 'Open beds', color: EM.teal },
    { n: occPct + '%', label: 'Occupancy', color: EM.teal },
    { n: incidents.length, label: 'Incidents', color: incidents.length ? EM.red : EM.teal, bg: incidents.length ? EM.redBg : EM.wash },
  ])}
    ${emailSection('Intakes', intakes.length, EM.sage)}
    ${emailList(intakes, i => `<b>${esc(i.name)}</b> &nbsp;<span style="color:${EM.soft}">${esc(i.house || 'unassigned')}${i.loc ? ' · ' + esc(i.loc) : ''}</span>`)}
    ${emailSection('Discharges', discharges.length, EM.gold)}
    ${emailList(discharges, d => `<b>${esc(d.name)}</b> &nbsp;<span style="color:${EM.soft}">${esc(d.discharge_type || 'discharged')}${d.house ? ' · ' + esc(d.house) : ''}</span>`)}
    ${emailSection('Incidents today', incidents.length, incidents.length ? EM.red : EM.teal)}
    ${emailList(incidents, i => `<b style="color:${EM.red}">${esc(i.type || 'Incident')}</b>${i.severity ? ` <span style="color:${EM.soft}">(${esc(i.severity)})</span>` : ''} ${i.house ? '· ' + esc(i.house) : ''}${i.summary ? '<br><span style="color:' + EM.soft + '">' + esc(i.summary) + '</span>' : ''}`)}
    ${emailSection('Maintenance', null)}
    <div style="font-size:15px">${openWO} open work order${openWO === 1 ? '' : 's'}${urgentWO.length ? ` · <b style="color:${EM.red}">${urgentWO.length} urgent</b>` : ''}${lowStock ? ` · <b>${lowStock}</b> supply item(s) low` : ''}.</div>
    ${urgentWO.length ? '<div style="margin-top:6px">' + emailList(urgentWO, w => `<b style="color:${EM.red}">Urgent:</b> ${esc(w.title)}${w.house ? ' — ' + esc(w.house) : ''}`) + '</div>' : ''}
    ${emailSection('Census by house', null)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;font-size:14px;border:1px solid ${EM.line};border-radius:10px;overflow:hidden">
      <tr style="background:${EM.teal};color:#fff"><th align="left" style="padding:9px 12px;font-weight:600">House</th><th align="left" style="padding:9px 12px;font-weight:600">Program</th><th align="right" style="padding:9px 12px;font-weight:600">Filled</th><th align="right" style="padding:9px 12px;font-weight:600">Open</th></tr>
      ${byHouse.map((h, n) => `<tr style="background:${n % 2 ? EM.wash : '#fff'}"><td style="padding:9px 12px;font-weight:600">${esc(h.name)}</td><td style="padding:9px 12px;color:${EM.soft}">${esc(h.program)}</td><td align="right" style="padding:9px 12px">${h.occupied}/${h.capacity}</td><td align="right" style="padding:9px 12px">${h.open}</td></tr>`).join('')}
      <tr style="background:${EM.sageBg};font-weight:800"><td style="padding:10px 12px">Total</td><td style="padding:10px 12px;font-weight:600;color:${EM.soft}">${Object.entries(byProgram).map(([p, n]) => `${esc(p)} ${n}`).join(' · ')}</td><td align="right" style="padding:10px 12px">${occupied}/${capacity}</td><td align="right" style="padding:10px 12px">${open}</td></tr>
    </table>`;
  const html = emailShell({ title: 'Daily Movement', subtitle: pretty, body });
  return { ...kpis, intakes, discharges, byHouse, byProgram, incidentList: incidents, urgentWO, subject: `${SL_BRAND} — Daily Movement · ${pretty} · census ${census}, +${intakes.length}/−${discharges.length}`, html };
}
function movementRecipients() {
  const a = (getState('housing_movement_clinical') || '').split(',');
  const b = (getState('housing_movement_leadership') || getState('census_email_to') || process.env.CENSUS_EMAIL_TO || '').split(',');
  return [...new Set([...a, ...b].map(s => s.trim()).filter(Boolean))];
}
// Real-time alert to housing leadership/clinical for urgent events (serious
// incidents, distress kiosk requests). On by default; uses the same recipients.
function housingAlertsOn() { return getState('housing_alerts') !== 'off'; }
async function alertHousing(subject, title, bodyHtml) {
  try {
    if (!housingAlertsOn() || !emailConfigured()) return;
    const list = movementRecipients(); if (!list.length) return;
    const html = emailShell({ title, subtitle: 'Action needed now', accent: EM.red, body: `<div style="font-size:15px;line-height:1.5">${bodyHtml}</div>` });
    for (const r of list) { try { await sendEmail({ to: r, subject, html, suppressCc: true }); } catch { /* keep going */ } }
  } catch { /* never block the request on an alert */ }
}
async function deliverDailyMovement(date) {
  if (!emailConfigured()) return { error: 'Email isn’t connected yet (Settings → Email).' };
  const list = movementRecipients();
  if (!list.length) return { error: 'Add clinical / leadership recipients first.' };
  const e = buildDailyMovement(date);
  let sent = 0; const failed = [];
  for (const r of list) {
    try { await sendEmail({ to: r, subject: e.subject, html: e.html, suppressCc: true }); sent += 1; }
    catch (err) { failed.push(`${r} (${err.message})`); }
  }
  return { sent, total: list.length, failed, census: e.census, intakes: e.intakes.length, discharges: e.discharges.length };
}

export function mountHousing(app) {
  housingSchema();
  try {
    // One-time: replace the earlier demo houses with the real Armada roster
    // (Coventry, High St, Perkins, …) and the live bed census from Neil's email.
    if (getState('housing_real_roster_v1') !== 'done') {
      HOUSING_TABLES.forEach(t => { try { db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist yet */ } });
      seedHousing();
      setState('housing_real_roster_v1', 'done');
      console.log('[housing] loaded the real house roster (105 beds across 10 homes)');
    } else {
      seedHousing();
    }
  } catch (e) { console.error('[housing] seed:', e.message); }
  try { seedHousingSurveys(); } catch (e) { console.error('[housing] survey seed:', e.message); }
  try { seedHousingSupplies(); } catch (e) { console.error('[housing] supply seed:', e.message); }

  /* ---- Sober Living resident kiosk (separate code; NOT behind staff auth) ---- */
  app.get('/api/sl-kiosk/data', requireSlKiosk, (req, res) => {
    const residents = db.prepare(`SELECT r.id, r.name, h.name house FROM housing_residents r
      LEFT JOIN housing_houses h ON h.id=r.house_id WHERE r.status='active' ORDER BY h.name, r.name`).all()
      .map(r => ({ id: r.id, pref: slPrefName(r.name), house: r.house || '' }));
    const surveys = db.prepare(`SELECT id, key, title, description FROM housing_surveys WHERE active=1 ORDER BY sort, id`).all();
    for (const s of surveys) s.questions = db.prepare(`SELECT id, category, text, type FROM housing_survey_questions WHERE survey_id=? ORDER BY sort, id`).all(s.id);
    res.json({ residents, categories: SL_REQUEST_CATEGORIES, surveys });
  });
  app.post('/api/sl-kiosk/checkin', requireSlKiosk, (req, res) => {
    const b = req.body || {};
    if (!b.resident_id) return res.status(400).json({ error: 'Please choose your name.' });
    const num = (v) => (v == null || v === '') ? null : Math.max(0, Math.min(10, +v || 0));
    const yn = (v) => v === 1 || v === true || v === '1' ? 1 : (v === 0 || v === false || v === '0' ? 0 : null);
    db.prepare(`INSERT INTO housing_checkins (resident_id,date,mood,cravings,meeting,slept_ok,need,note) VALUES (?,?,?,?,?,?,?,?)`)
      .run(num(b.resident_id) ? b.resident_id : null, todayStr(), num(b.mood), num(b.cravings), yn(b.meeting), yn(b.slept_ok), (b.need || '').trim().slice(0, 400) || null, (b.note || '').trim().slice(0, 600) || null);
    res.json({ ok: true });
  });
  app.post('/api/sl-kiosk/request', requireSlKiosk, (req, res) => {
    const b = req.body || {};
    if (!b.resident_id) return res.status(400).json({ error: 'Please choose your name so we can help you.' });
    const text = (b.text || '').trim(); if (!text) return res.status(400).json({ error: 'Tell us what you need.' });
    const priority = SL_DISTRESS.test(text) ? 'Urgent' : 'Normal';
    db.prepare(`INSERT INTO housing_requests (resident_id,category,text,priority) VALUES (?,?,?,?)`)
      .run(b.resident_id, b.category || 'Something else', text.slice(0, 800), priority);
    if (priority === 'Urgent') {
      const who = db.prepare(`SELECT name FROM housing_residents WHERE id=?`).get(b.resident_id)?.name || 'A resident';
      alertHousing(`⚠ Urgent kiosk request — ${who}`, 'Urgent resident request', `<p><b>${who}</b> sent an urgent request from the ${SL_BRAND} kiosk:</p><blockquote style="border-left:3px solid ${EM.red};margin:10px 0;padding:6px 0 6px 12px;color:#444">${text.replace(/[<>&]/g, '')}</blockquote><p><b>Go to them now.</b></p>`);
    }
    res.json({ ok: true });
  });
  app.post('/api/sl-kiosk/suggestion', requireSlKiosk, (req, res) => {
    const text = (req.body?.text || '').trim(); if (!text) return res.status(400).json({ error: 'Tell us your idea.' });
    db.prepare(`INSERT INTO housing_suggestions (resident_id,text) VALUES (?,?)`).run(req.body?.resident_id || null, text.slice(0, 1000));
    res.json({ ok: true });
  });
  app.post('/api/sl-kiosk/survey', requireSlKiosk, (req, res) => {
    const b = req.body || {};
    const survey = db.prepare(`SELECT id FROM housing_surveys WHERE id=?`).get(b.survey_id);
    if (!survey || !Array.isArray(b.answers) || !b.answers.length) return res.status(400).json({ error: 'No answers' });
    const rid = Number(db.prepare(`INSERT INTO housing_survey_responses (survey_id,resident_id) VALUES (?,?)`).run(survey.id, b.resident_id || null).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO housing_survey_answers (response_id,question_id,value_num,value_text) VALUES (?,?,?,?)`);
    for (const a of b.answers) { if (a.question_id == null) continue; ins.run(rid, a.question_id, (a.num === 0 || a.num) ? Number(a.num) : null, a.text?.trim() || null); }
    res.json({ ok: true });
  });

  // Gate the entire /api/housing surface to housing staff + admin/ED (defense in
  // depth — the front-end already hides it, this stops direct API access too).
  app.use('/api/housing', requireAuth, requireHousing);

  // ---- Sober Living kiosk code (admin-managed; shown to staff so they can set up iPads) ----
  app.get('/api/housing/kiosk-code', requireAuth, (req, res) => {
    if (!(req.user.role === 'admin' || req.user.job_role === 'Executive Director')) return res.status(403).json({ error: 'Admins only' });
    res.json({ code: slKioskCode(), weak: slKioskCodeWeak() });
  });
  app.post('/api/housing/kiosk-code', requireAuth, requireAdmin, (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (code.length < 6) return res.status(400).json({ error: 'Use at least 6 characters.' });
    setState('sl_kiosk_code', code);
    audit({ user: req.user, action: 'HOUSING_KIOSK_CODE_SET', ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Resident Voice: kiosk results, walled off under Sober Living ----
  app.get('/api/housing/voice', requireAuth, (req, res) => {
    const nm = (rid) => rid ? (db.prepare(`SELECT name FROM housing_residents WHERE id=?`).get(rid)?.name || null) : null;
    const checkins = db.prepare(`SELECT * FROM housing_checkins ORDER BY id DESC LIMIT 60`).all().map(c => ({ ...c, name: nm(c.resident_id) }));
    const requests = db.prepare(`SELECT * FROM housing_requests ORDER BY (status='open') DESC, (priority='Urgent') DESC, id DESC LIMIT 80`).all().map(r => ({ ...r, name: nm(r.resident_id) }));
    const suggestions = db.prepare(`SELECT * FROM housing_suggestions ORDER BY id DESC LIMIT 60`).all().map(s => ({ ...s, name: nm(s.resident_id) }));
    const surveys = db.prepare(`SELECT id, key, title FROM housing_surveys WHERE active=1 ORDER BY sort, id`).all().map(s => {
      const responses = db.prepare(`SELECT COUNT(*) c FROM housing_survey_responses WHERE survey_id=?`).get(s.id).c;
      const avg = db.prepare(`SELECT AVG(value_num) a FROM housing_survey_answers an JOIN housing_survey_responses r ON r.id=an.response_id WHERE r.survey_id=? AND an.value_num IS NOT NULL`).get(s.id).a;
      return { ...s, responses, avg: avg != null ? +avg.toFixed(1) : null };
    });
    const recentText = db.prepare(`SELECT an.value_text text, r.created FROM housing_survey_answers an JOIN housing_survey_responses r ON r.id=an.response_id WHERE an.value_text IS NOT NULL ORDER BY r.id DESC LIMIT 25`).all();
    res.json({
      checkins, requests, suggestions, surveys, recentText,
      kpis: {
        openRequests: requests.filter(r => r.status === 'open').length,
        urgent: requests.filter(r => r.status === 'open' && r.priority === 'Urgent').length,
        checkinsToday: checkins.filter(c => c.date === todayStr()).length,
        flagged: checkins.filter(c => c.date === todayStr() && ((c.cravings != null && c.cravings >= 6) || (c.mood != null && c.mood <= 3))).length,
      },
    });
  });
  app.post('/api/housing/voice/request/:id', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT * FROM housing_requests WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE housing_requests SET status='done', handled_by=?, handled_at=datetime('now') WHERE id=?`).run(req.user.name, req.params.id);
    audit({ user: req.user, action: 'HOUSING_REQUEST_DONE', detail: cur.text?.slice(0, 60), ip: req.ip });
    res.json({ ok: true });
  });
  app.post('/api/housing/voice/checkin/:id/seen', requireAuth, (req, res) => {
    db.prepare(`UPDATE housing_checkins SET seen=1 WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });
  // Convert a resident kiosk request into a tracked maintenance work order.
  app.post('/api/housing/voice/request/:id/to-work-order', requireAuth, (req, res) => {
    const rq = db.prepare(`SELECT * FROM housing_requests WHERE id=?`).get(req.params.id);
    if (!rq) return res.status(404).json({ error: 'Not found' });
    const resi = rq.resident_id ? db.prepare(`SELECT name, house_id FROM housing_residents WHERE id=?`).get(rq.resident_id) : null;
    const priority = rq.priority === 'Urgent' ? 'Urgent' : 'Normal';
    const title = (rq.text || 'Resident maintenance request').slice(0, 120);
    db.prepare(`INSERT INTO housing_maintenance (house_id,area,title,detail,priority,reported_by) VALUES (?,?,?,?,?,?)`)
      .run(resi?.house_id || null, 'Other', title, resi ? `From ${resi.name} (kiosk request)` : 'From resident kiosk request', priority, req.user.name);
    db.prepare(`UPDATE housing_requests SET status='done', handled_by=?, handled_at=datetime('now') WHERE id=?`).run(req.user.name, rq.id);
    audit({ user: req.user, action: 'HOUSING_REQ_TO_WO', detail: title, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Reference data ----
  app.get('/api/housing/meta', requireAuth, (req, res) => res.json({
    reccapDomains: RECCAP_DOMAINS, phases: PHASES, loc: LOC, orhStandards: ORH_STANDARDS,
  }));

  // ---- Dashboard / HQ ----
  app.get('/api/housing/overview', requireAuth, (req, res) => {
    const houses = db.prepare(`SELECT * FROM housing_houses WHERE active=1 ORDER BY level DESC, name`).all();
    const occ = occMap();
    const residents = db.prepare(`SELECT * FROM housing_residents WHERE status='active'`).all();
    const capacity = houses.reduce((a, h) => a + (h.capacity || 0), 0);
    // occupancy is bed-based (reflects the census even before every resident has
    // an individual record), with residents counted when they're entered.
    const occupied = Object.values(occ).reduce((a, o) => a + (o.occupied || 0), 0) || residents.length;
    // by program (PHP / IOP / Graduate) from occupied beds per house
    const byLoc = {};
    houses.forEach(h => { const k = h.program || h.gender || 'Other'; byLoc[k] = (byLoc[k] || 0) + ((occ[h.id]?.occupied) || 0); });
    // recovery capital average
    const caps = residents.map(r => latestCap(r.id)).filter(Boolean);
    const reccapAvg = caps.length ? +(caps.reduce((a, c) => a + c.total, 0) / caps.length).toFixed(1) : null;
    // balances outstanding
    const balanceOut = residents.reduce((a, r) => a + Math.max(0, balanceOf(r.id)), 0);
    // screens due (no screen in 7+ days), curfew tonight count, clinical under-dose
    const screensDue = residents.filter(r => { const s = lastScreen(r.id); return !s || (Date.now() - new Date(s.date).getTime()) > 7 * 86400000; }).length;
    const underDose = residents.filter(r => { const t = LOC[r.loc]?.weeklyHours || 0; return t > 0 && clinHoursThisWeek(r.id) < t * 0.6; }).length;
    // ORH compliance %
    const orhRows = db.prepare(`SELECT status, COUNT(*) c FROM housing_orh GROUP BY status`).all();
    const orhTot = orhRows.reduce((a, r) => a + r.c, 0);
    const orhMet = (orhRows.find(r => r.status === 'met')?.c || 0);
    const orhPartial = (orhRows.find(r => r.status === 'partial')?.c || 0);
    const orhPct = orhTot ? Math.round(((orhMet + orhPartial * 0.5) / orhTot) * 100) : 0;
    // returns to use this month (positive screens or relapse incidents)
    const monthStart = todayStr().slice(0, 8) + '01';
    const returnsToUse = db.prepare(`SELECT COUNT(*) c FROM housing_screens WHERE result='positive' AND date>=?`).get(monthStart).c
      + db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE type='Return to use' AND date>=?`).get(monthStart).c;
    const grievOpen = db.prepare(`SELECT COUNT(*) c FROM housing_grievances WHERE status='open'`).get().c;
    const openIncidents = db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE status='open'`).get().c;

    res.json({
      kpis: {
        houses: houses.length, capacity, occupied, open: Math.max(0, capacity - occupied),
        occPct: capacity ? Math.round((occupied / capacity) * 100) : 0,
        reccapAvg, balanceOut, screensDue, underDose, orhPct, returnsToUse, grievOpen, openIncidents,
      },
      byLoc,
      houses: houses.map(h => ({
        ...h,
        occ: occ[h.id] || { open: 0, occupied: 0, hold: 0, maintenance: 0 },
        residents: residents.filter(r => r.house_id === h.id).length,
      })),
    });
  });

  // ---- Houses & Beds ----
  app.get('/api/housing/houses', requireAuth, (req, res) => {
    const occ = occMap();
    const houses = db.prepare(`SELECT * FROM housing_houses ORDER BY active DESC, level DESC, name`).all();
    res.json(houses.map(h => {
      const beds = db.prepare(`SELECT b.*, r.name resident_name, r.loc resident_loc, r.phase resident_phase
        FROM housing_beds b LEFT JOIN housing_residents r ON r.id=b.resident_id WHERE b.house_id=? ORDER BY b.room, b.label`).all(h.id);
      return { ...h, beds, occ: occ[h.id] || { open: 0, occupied: 0, hold: 0, maintenance: 0 } };
    }));
  });

  app.post('/api/housing/houses', requireAuth, requireAdmin, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`INSERT INTO housing_houses (name,level,orh_cert,address,city,gender,program,mat_friendly,capacity,manager,phone,opened,color,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      (b.name || 'New House').trim(), b.level || 'L2', b.orh_cert || null, b.address || null, b.city || null,
      b.gender || 'Any', b.program || null, b.mat_friendly ? 1 : 0, num(b.capacity), b.manager || null, b.phone || null,
      b.opened || null, b.color || null, b.notes || null);
    audit({ user: req.user, action: 'HOUSING_HOUSE_ADD', detail: b.name, ip: req.ip });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  app.post('/api/housing/houses/:id', requireAuth, requireAdmin, (req, res) => {
    const b = req.body || {};
    const cur = db.prepare(`SELECT * FROM housing_houses WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const f = (k, d) => (b[k] !== undefined ? b[k] : d);
    db.prepare(`UPDATE housing_houses SET name=?,level=?,orh_cert=?,address=?,city=?,gender=?,program=?,mat_friendly=?,capacity=?,manager=?,phone=?,opened=?,color=?,notes=?,active=? WHERE id=?`)
      .run(f('name', cur.name), f('level', cur.level), f('orh_cert', cur.orh_cert), f('address', cur.address), f('city', cur.city),
        f('gender', cur.gender), f('program', cur.program), b.mat_friendly !== undefined ? (b.mat_friendly ? 1 : 0) : cur.mat_friendly, num(f('capacity', cur.capacity)),
        f('manager', cur.manager), f('phone', cur.phone), f('opened', cur.opened), f('color', cur.color), f('notes', cur.notes),
        b.active !== undefined ? (b.active ? 1 : 0) : cur.active, req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/housing/houses/:id/beds', requireAuth, requireAdmin, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`INSERT INTO housing_beds (house_id,room,label,status,notes) VALUES (?,?,?,?,?)`)
      .run(req.params.id, b.room || '01', b.label || (b.room || '01') + 'A', b.status || 'open', b.notes || null);
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  app.post('/api/housing/beds/:id', requireAuth, (req, res) => {
    const b = req.body || {};
    const bed = db.prepare(`SELECT * FROM housing_beds WHERE id=?`).get(req.params.id);
    if (!bed) return res.status(404).json({ error: 'Not found' });
    // status-only change (e.g. mark maintenance/hold/open)
    if (b.status && b.status !== 'occupied') {
      if (bed.resident_id) db.prepare(`UPDATE housing_residents SET bed_id=NULL WHERE id=?`).run(bed.resident_id);
      db.prepare(`UPDATE housing_beds SET status=?, resident_id=NULL, notes=? WHERE id=?`).run(b.status, b.notes ?? bed.notes, req.params.id);
    } else {
      db.prepare(`UPDATE housing_beds SET notes=? WHERE id=?`).run(b.notes ?? bed.notes, req.params.id);
    }
    res.json({ ok: true });
  });

  app.delete('/api/housing/beds/:id', requireAuth, requireAdmin, (req, res) => {
    const bed = db.prepare(`SELECT * FROM housing_beds WHERE id=?`).get(req.params.id);
    if (bed?.resident_id) db.prepare(`UPDATE housing_residents SET bed_id=NULL WHERE id=?`).run(bed.resident_id);
    db.prepare(`DELETE FROM housing_beds WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Assign / move a resident to a bed
  app.post('/api/housing/beds/:id/assign', requireAuth, (req, res) => {
    const rid = num(req.body?.resident_id);
    const bed = db.prepare(`SELECT * FROM housing_beds WHERE id=?`).get(req.params.id);
    if (!bed) return res.status(404).json({ error: 'Bed not found' });
    const r = db.prepare(`SELECT * FROM housing_residents WHERE id=?`).get(rid);
    if (!r) return res.status(404).json({ error: 'Resident not found' });
    // free the resident's old bed and any current occupant of this bed
    if (r.bed_id) db.prepare(`UPDATE housing_beds SET status='open', resident_id=NULL WHERE id=?`).run(r.bed_id);
    if (bed.resident_id && bed.resident_id !== rid) db.prepare(`UPDATE housing_residents SET bed_id=NULL WHERE id=?`).run(bed.resident_id);
    db.prepare(`UPDATE housing_beds SET status='occupied', resident_id=? WHERE id=?`).run(rid, bed.id);
    db.prepare(`UPDATE housing_residents SET bed_id=?, house_id=?, status='active' WHERE id=?`).run(bed.id, bed.house_id, rid);
    audit({ user: req.user, action: 'HOUSING_BED_ASSIGN', detail: `${r.name} → bed ${bed.label}`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Residents ----
  app.get('/api/housing/residents', requireAuth, (req, res) => {
    const status = req.query.status || 'active';
    const where = status === 'all' ? '' : `WHERE status=?`;
    const rows = status === 'all'
      ? db.prepare(`SELECT * FROM housing_residents ORDER BY name`).all()
      : db.prepare(`SELECT * FROM housing_residents ${where} ORDER BY name`).all(status);
    res.json(rows.map(residentCard));
  });

  app.get('/api/housing/residents/:id', requireAuth, (req, res) => {
    const r = db.prepare(`SELECT * FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const card = residentCard(r);
    audit({ user: req.user, action: 'HOUSING_RESIDENT_VIEW', detail: r.name, ip: req.ip });
    res.json({
      ...card,
      capHistory: db.prepare(`SELECT * FROM housing_reccap WHERE resident_id=? ORDER BY date`).all(r.id).map(c => ({ ...c, scores: P(c.scores, {}) })),
      supports: db.prepare(`SELECT * FROM housing_supports WHERE resident_id=? ORDER BY date DESC LIMIT 30`).all(r.id),
      screens: db.prepare(`SELECT * FROM housing_screens WHERE resident_id=? ORDER BY date DESC LIMIT 20`).all(r.id),
      ledger: db.prepare(`SELECT * FROM housing_ledger WHERE resident_id=? ORDER BY date DESC, id DESC LIMIT 40`).all(r.id),
      coordination: db.prepare(`SELECT * FROM housing_coordination WHERE resident_id=? ORDER BY date DESC LIMIT 20`).all(r.id),
      incidents: db.prepare(`SELECT * FROM housing_incidents WHERE resident_id=? ORDER BY date DESC LIMIT 20`).all(r.id),
      forms: db.prepare(`SELECT * FROM housing_forms WHERE resident_id=?`).all(r.id).map(f => ({ ...f, data: P(f.data, {}) })),
      payplanHistory: db.prepare(`SELECT * FROM housing_payplans WHERE resident_id=? ORDER BY id DESC LIMIT 10`).all(r.id),
      rentlog: db.prepare(`SELECT * FROM housing_rentlog WHERE resident_id=? ORDER BY week DESC, id DESC LIMIT 16`).all(r.id),
      employment: currentEmployment(r.id) || null,
      employmentHistory: db.prepare(`SELECT * FROM housing_employment WHERE resident_id=? ORDER BY date DESC LIMIT 10`).all(r.id),
      jobsearch: db.prepare(`SELECT * FROM housing_jobsearch WHERE resident_id=? ORDER BY date DESC LIMIT 30`).all(r.id),
    });
  });

  app.post('/api/housing/residents', requireAuth, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`INSERT INTO housing_residents
      (name,dob,phone,email,house_id,loc,phase,status,move_in,sober_date,recovery_coach,payer,insurance,employment,education,mat,sponsor,home_group,emergency_name,emergency_phone,goals,notes,client_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      (b.name || 'New Resident').trim(), b.dob || null, b.phone || null, b.email || null,
      b.house_id ? num(b.house_id) : null, b.loc || 'IOP', num(b.phase, 1), b.status || (b.house_id ? 'active' : 'waitlist'),
      b.move_in || todayStr(), b.sober_date || null, b.recovery_coach || null, b.payer || null, b.insurance || null,
      b.employment || null, b.education || null, b.mat || null, b.sponsor || null, b.home_group || null,
      b.emergency_name || null, b.emergency_phone || null, b.goals || null, b.notes || null, b.client_id ? num(b.client_id) : null);
    const id = Number(r.lastInsertRowid);
    // auto-place into a bed if requested
    if (b.bed_id) {
      const bed = db.prepare(`SELECT * FROM housing_beds WHERE id=?`).get(num(b.bed_id));
      if (bed && bed.status === 'open') {
        db.prepare(`UPDATE housing_beds SET status='occupied', resident_id=? WHERE id=?`).run(id, bed.id);
        db.prepare(`UPDATE housing_residents SET bed_id=? WHERE id=?`).run(bed.id, id);
      }
    }
    audit({ user: req.user, action: 'HOUSING_RESIDENT_ADD', detail: b.name, ip: req.ip });
    res.json({ ok: true, id });
  });

  // Bulk import the Akron patient export (Kipu "download patients" CSV). This is
  // PHI in volume, so it is admin-only and never persisted to the repo — the file
  // is uploaded into the running app, parsed, Dayton excluded, and tied only to
  // the 10 Akron houses.
  app.post('/api/housing/import', requireAuth, requireAdmin, (req, res) => {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string' || csv.length < 40) return res.status(400).json({ error: 'Upload the patient-export CSV.' });
    try {
      const out = importAkronCsv(csv, { includeAlumni: !!req.body.includeAlumni }, req.user);
      if (out.error) return res.status(400).json(out);
      audit({ user: req.user, action: 'HOUSING_IMPORT', detail: `imported ${out.imported} current / ${out.alumni} alumni`, ip: req.ip });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/housing/residents/:id', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT * FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const cols = ['name', 'dob', 'phone', 'email', 'loc', 'phase', 'status', 'move_in', 'sober_date', 'recovery_coach', 'payer', 'insurance', 'employment', 'education', 'mat', 'sponsor', 'home_group', 'emergency_name', 'emergency_phone', 'goals', 'notes'];
    const sets = []; const vals = [];
    for (const c of cols) if (b[c] !== undefined) { sets.push(`${c}=?`); vals.push(b[c]); }
    if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE housing_residents SET ${sets.join(',')} WHERE id=?`).run(...vals); }
    audit({ user: req.user, action: 'HOUSING_RESIDENT_EDIT', detail: cur.name, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Profile photo (stored as a resized data URL; served as image bytes) ----
  app.get('/api/housing/residents/:id/photo', requireAuth, (req, res) => {
    const row = db.prepare(`SELECT photo FROM housing_residents WHERE id=?`).get(req.params.id);
    const m = row && row.photo && /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(row.photo);
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(m[2], 'base64'));
  });

  app.post('/api/housing/residents/:id/photo', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT id, name, photo_consent FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    let photo = req.body?.photo ?? null;
    if (photo !== null) {
      if (typeof photo !== 'string' || !/^data:image\/[\w.+-]+;base64,/.test(photo)) return res.status(400).json({ error: 'Expected an image.' });
      if (photo.length > 3_000_000) return res.status(413).json({ error: 'Image too large — it should resize client-side first.' });
      // A face photo is PHI: require a consent attestation (this time, or already on file).
      const consented = req.body?.consent === true;
      if (!consented && !cur.photo_consent) return res.status(400).json({ error: 'Photo consent is required before saving a resident photo.' });
      if (consented) db.prepare(`UPDATE housing_residents SET photo_consent=? WHERE id=?`).run(`Consent on file — ${req.user.name} · ${todayStr()}`, cur.id);
    }
    db.prepare(`UPDATE housing_residents SET photo=? WHERE id=?`).run(photo, cur.id);
    audit({ user: req.user, action: photo ? 'HOUSING_PHOTO_SET' : 'HOUSING_PHOTO_CLEAR', detail: cur.name, ip: req.ip });
    res.json({ ok: true });
  });

  // Discharge — the fond farewell. Frees the bed, records disposition.
  app.post('/api/housing/residents/:id/discharge', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT * FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (cur.bed_id) db.prepare(`UPDATE housing_beds SET status='open', resident_id=NULL WHERE id=?`).run(cur.bed_id);
    db.prepare(`UPDATE housing_residents SET status='discharged', bed_id=NULL, discharge_date=?, discharge_type=?, notes=COALESCE(notes,'')||? WHERE id=?`)
      .run(b.date || todayStr(), b.type || 'Completed', b.note ? `\n[Discharge ${b.date || todayStr()}] ${b.note}` : '', req.params.id);
    audit({ user: req.user, action: 'HOUSING_DISCHARGE', detail: `${cur.name} — ${b.type || 'Completed'}`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Restrictions (blackout / behavioral holds + eligibility to lift) ----
  app.get('/api/housing/restrictions/meta', requireAuth, (req, res) => res.json({ types: RESTRICTION_TYPES }));
  app.post('/api/housing/residents/:id/restriction', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT id, name FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const start = b.start_date || todayStr();
    const days = b.days != null && b.days !== '' ? Math.max(0, num(b.days)) : null;
    let end = b.end_date || null;
    if (!end && days) { const d = new Date(start); d.setDate(d.getDate() + days); end = d.toISOString().slice(0, 10); }
    // one active restriction at a time — supersede any existing active one
    db.prepare(`UPDATE housing_restrictions SET status='superseded' WHERE resident_id=? AND status='active'`).run(cur.id);
    db.prepare(`INSERT INTO housing_restrictions (resident_id,type,reason,start_date,days,end_date,conditions,placed_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(cur.id, b.type || 'Behavioral restriction', b.reason || null, start, days, end, b.conditions || null, req.user.name);
    audit({ user: req.user, action: 'HOUSING_RESTRICTION_SET', detail: `${cur.name} — ${b.type || ''}`, ip: req.ip });
    res.json({ ok: true });
  });
  app.post('/api/housing/restrictions/:id/lift', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT r.*, h.name FROM housing_restrictions r LEFT JOIN housing_residents h ON h.id=r.resident_id WHERE r.id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE housing_restrictions SET status='lifted', lifted_by=?, lifted_at=datetime('now'), lift_note=? WHERE id=?`)
      .run(req.user.name, (req.body?.note || '').trim() || null, req.params.id);
    audit({ user: req.user, action: 'HOUSING_RESTRICTION_LIFT', detail: cur.name, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Maintenance & Supplies (work orders, inventory, automated reordering) ----
  app.get('/api/housing/maintenance/meta', requireAuth, (req, res) => res.json({
    areas: MAINT_AREAS, categories: SUPPLY_CATEGORIES,
    houses: db.prepare(`SELECT id, name FROM housing_houses WHERE active=1 ORDER BY name`).all(),
  }));

  app.get('/api/housing/maintenance', requireAuth, (req, res) => {
    const status = req.query.status || 'open';
    const where = status === 'all' ? '' : `WHERE m.status=?`;
    const rows = (status === 'all'
      ? db.prepare(`SELECT m.*, h.name house FROM housing_maintenance m LEFT JOIN housing_houses h ON h.id=m.house_id ORDER BY (m.status='open') DESC, (m.priority='Urgent') DESC, m.id DESC`).all()
      : db.prepare(`SELECT m.*, h.name house FROM housing_maintenance m LEFT JOIN housing_houses h ON h.id=m.house_id ${where} ORDER BY (m.priority='Urgent') DESC, m.id DESC`).all(status));
    res.json({
      rows,
      kpis: {
        open: db.prepare(`SELECT COUNT(*) c FROM housing_maintenance WHERE status='open'`).get().c,
        urgent: db.prepare(`SELECT COUNT(*) c FROM housing_maintenance WHERE status='open' AND priority='Urgent'`).get().c,
      },
    });
  });
  app.post('/api/housing/maintenance', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!(b.title || '').trim()) return res.status(400).json({ error: 'What needs fixing?' });
    db.prepare(`INSERT INTO housing_maintenance (house_id,area,title,detail,priority,reported_by,assigned_to) VALUES (?,?,?,?,?,?,?)`)
      .run(b.house_id ? num(b.house_id) : null, b.area || 'Other', b.title.trim(), b.detail || null, b.priority || 'Normal', req.user.name, b.assigned_to || null);
    audit({ user: req.user, action: 'HOUSING_MAINT_ADD', detail: b.title, ip: req.ip });
    res.json({ ok: true });
  });
  app.post('/api/housing/maintenance/:id', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT * FROM housing_maintenance WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (b.status === 'done') {
      db.prepare(`UPDATE housing_maintenance SET status='done', resolution=?, cost=?, resolved_at=datetime('now') WHERE id=?`)
        .run((b.resolution || '').trim() || null, b.cost != null ? num(b.cost) : cur.cost, req.params.id);
    } else {
      const sets = []; const vals = [];
      for (const c of ['area', 'title', 'detail', 'priority', 'status', 'assigned_to']) if (b[c] !== undefined) { sets.push(`${c}=?`); vals.push(b[c]); }
      if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE housing_maintenance SET ${sets.join(',')} WHERE id=?`).run(...vals); }
    }
    res.json({ ok: true });
  });

  // Inventory
  app.get('/api/housing/inventory', requireAuth, (req, res) => {
    const items = db.prepare(`SELECT i.*, h.name house FROM housing_inventory i LEFT JOIN housing_houses h ON h.id=i.house_id ORDER BY i.category, i.name`).all()
      .map(i => ({ ...i, low: isLow(i) }));
    const low = items.filter(i => i.low);
    res.json({
      items, categories: SUPPLY_CATEGORIES,
      kpis: {
        items: items.length, low: low.length,
        reorderValue: +low.reduce((a, i) => a + (i.reorder_qty || 0) * (i.unit_cost || 0), 0).toFixed(2),
      },
    });
  });
  app.post('/api/housing/inventory', requireAuth, (req, res) => {
    const b = req.body || {};
    if (b.id) {
      const cur = db.prepare(`SELECT * FROM housing_inventory WHERE id=?`).get(b.id);
      if (!cur) return res.status(404).json({ error: 'Not found' });
      const sets = []; const vals = [];
      for (const c of ['name', 'category', 'unit', 'qty', 'par', 'reorder_qty', 'vendor', 'sku', 'unit_cost', 'auto', 'house_id']) if (b[c] !== undefined) { sets.push(`${c}=?`); vals.push(b[c] === '' ? null : b[c]); }
      sets.push(`updated=datetime('now')`); vals.push(b.id);
      db.prepare(`UPDATE housing_inventory SET ${sets.join(',')} WHERE id=?`).run(...vals);
    } else {
      if (!(b.name || '').trim()) return res.status(400).json({ error: 'Item name?' });
      db.prepare(`INSERT INTO housing_inventory (house_id,name,category,unit,qty,par,reorder_qty,vendor,sku,unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(b.house_id ? num(b.house_id) : null, b.name.trim(), b.category || 'Other', b.unit || 'each', num(b.qty), num(b.par), num(b.reorder_qty), b.vendor || null, b.sku || null, num(b.unit_cost));
    }
    res.json({ ok: true });
  });
  // Quick stock adjust (count in / use): delta can be + or -.
  app.post('/api/housing/inventory/:id/adjust', requireAuth, (req, res) => {
    const cur = db.prepare(`SELECT * FROM housing_inventory WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const qty = b.set != null ? num(b.set) : Math.max(0, (cur.qty || 0) + num(b.delta));
    db.prepare(`UPDATE housing_inventory SET qty=?, updated=datetime('now') WHERE id=?`).run(qty, req.params.id);
    res.json({ ok: true, qty });
  });

  // Orders + automated reordering
  app.get('/api/housing/orders', requireAuth, (req, res) => {
    const orders = db.prepare(`SELECT * FROM housing_orders ORDER BY id DESC LIMIT 40`).all().map(o => ({
      ...o, lines: db.prepare(`SELECT * FROM housing_order_lines WHERE order_id=?`).all(o.id),
    }));
    res.json({ orders });
  });
  // Build a suggested order from everything at/below par that's set to auto-reorder.
  app.post('/api/housing/orders/suggest', requireAuth, (req, res) => {
    const low = db.prepare(`SELECT * FROM housing_inventory WHERE auto=1`).all().filter(isLow);
    if (!low.length) return res.json({ ok: true, empty: true });
    // group by vendor so each order goes to one supplier
    const byVendor = {};
    for (const it of low) { const v = it.vendor || 'Unassigned vendor'; (byVendor[v] = byVendor[v] || []).push(it); }
    const made = [];
    for (const [vendor, items] of Object.entries(byVendor)) {
      const total = items.reduce((a, i) => a + (i.reorder_qty || 0) * (i.unit_cost || 0), 0);
      const oid = Number(db.prepare(`INSERT INTO housing_orders (vendor,status,total,by) VALUES (?,?,?,?)`).run(vendor, 'suggested', +total.toFixed(2), req.user.name).lastInsertRowid);
      const ln = db.prepare(`INSERT INTO housing_order_lines (order_id,item_id,name,qty,unit_cost) VALUES (?,?,?,?,?)`);
      for (const it of items) ln.run(oid, it.id, it.name, it.reorder_qty || 0, it.unit_cost || 0);
      made.push(oid);
    }
    audit({ user: req.user, action: 'HOUSING_ORDER_SUGGEST', detail: `${low.length} low items → ${made.length} order(s)`, ip: req.ip });
    res.json({ ok: true, orders: made.length, items: low.length });
  });
  app.post('/api/housing/orders/:id/status', requireAuth, (req, res) => {
    const o = db.prepare(`SELECT * FROM housing_orders WHERE id=?`).get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    const status = req.body?.status;
    if (status === 'ordered') db.prepare(`UPDATE housing_orders SET status='ordered', ordered_at=datetime('now') WHERE id=?`).run(o.id);
    else if (status === 'received') {
      // Receiving restocks inventory by each line's quantity.
      const lines = db.prepare(`SELECT * FROM housing_order_lines WHERE order_id=?`).all(o.id);
      const upd = db.prepare(`UPDATE housing_inventory SET qty=qty+?, updated=datetime('now') WHERE id=?`);
      for (const l of lines) if (l.item_id) upd.run(l.qty || 0, l.item_id);
      db.prepare(`UPDATE housing_orders SET status='received', received_at=datetime('now') WHERE id=?`).run(o.id);
    } else if (status === 'cancelled') db.prepare(`UPDATE housing_orders SET status='cancelled' WHERE id=?`).run(o.id);
    audit({ user: req.user, action: 'HOUSING_ORDER_' + (status || '').toUpperCase(), detail: o.vendor, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Daily Movement report (preview, send now, auto-email settings) ----
  const canMovement = (u) => u && (u.role === 'admin' || u.job_role === 'Executive Director' || HOUSING_ACCESS_ROLES.includes(u.job_role));
  app.get('/api/housing/daily-movement', requireAuth, (req, res) => {
    const report = buildDailyMovement(req.query.date);
    res.json({
      ...report,
      recipients: movementRecipients(),
      clinical: getState('housing_movement_clinical') || '',
      leadership: getState('housing_movement_leadership') || getState('census_email_to') || '',
      auto: getState('housing_movement_auto') === 'on',
      hour: +(getState('housing_movement_hour') || 8),
      alerts: housingAlertsOn(),
      emailReady: emailConfigured(), from: emailStatus().from || '',
      lastSent: getState('housing_movement_last') || null,
    });
  });
  app.post('/api/housing/daily-movement/send', requireAuth, async (req, res) => {
    if (!canMovement(req.user)) return res.status(403).json({ error: 'Leadership / housing staff only.' });
    try {
      const r = await deliverDailyMovement(req.body?.date);
      if (r.error) return res.status(400).json(r);
      audit({ user: req.user, action: 'HOUSING_MOVEMENT_SEND', detail: `${r.sent}/${r.total} · census ${r.census} · +${r.intakes}/-${r.discharges}`, ip: req.ip });
      if (!r.sent) return res.status(502).json({ error: 'Could not send to anyone. ' + (r.failed[0] || '') });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.post('/api/housing/daily-movement/settings', requireAuth, (req, res) => {
    if (!(req.user.role === 'admin' || req.user.job_role === 'Executive Director')) return res.status(403).json({ error: 'Leadership only.' });
    const b = req.body || {};
    if (b.clinical != null) setState('housing_movement_clinical', String(b.clinical).trim());
    if (b.leadership != null) setState('housing_movement_leadership', String(b.leadership).trim());
    if (b.auto != null) setState('housing_movement_auto', b.auto ? 'on' : 'off');
    if (b.alerts != null) setState('housing_alerts', b.alerts ? 'on' : 'off');
    if (b.hour != null) setState('housing_movement_hour', String(Math.min(23, Math.max(0, num(b.hour)))));
    audit({ user: req.user, action: 'HOUSING_MOVEMENT_SETTINGS', ip: req.ip });
    res.json({ ok: true });
  });
  // In-app daily scheduler (always-on web service; no external cron needed).
  if (!app._housingMovementTimer) {
    app._housingMovementTimer = setInterval(async () => {
      try {
        if (getState('housing_movement_auto') !== 'on') return;
        const hour = Math.min(23, Math.max(0, +(getState('housing_movement_hour') || 8)));
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
        const h = (+parts.find(p => p.type === 'hour').value) % 24;
        const m = +parts.find(p => p.type === 'minute').value;
        if (h !== hour || m > 9) return;
        const today = appToday();
        if (getState('housing_movement_last') === today) return;
        setState('housing_movement_last', today);   // mark before sending to avoid double-fire
        const r = await deliverDailyMovement(today);
        audit({ user: { name: 'System (auto-movement)' }, action: 'HOUSING_MOVEMENT_AUTO', detail: r.error ? ('blocked: ' + r.error) : `${r.sent}/${r.total} · census ${r.census}`, ip: 'scheduler' });
      } catch (e) { console.error('[housing movement auto]', e.message); }
    }, 60 * 1000);
    app._housingMovementTimer.unref?.();
  }

  // ---- Recovery capital ----
  app.post('/api/housing/residents/:id/reccap', requireAuth, (req, res) => {
    const scores = req.body?.scores || {};
    const keys = RECCAP_DOMAINS.map(d => d[0]);
    let tot = 0, n = 0;
    keys.forEach(k => { if (scores[k] != null) { tot += num(scores[k]); n++; } });
    const total = n ? +(tot / n).toFixed(1) : 0;
    db.prepare(`INSERT INTO housing_reccap (resident_id,date,scores,total,note,by) VALUES (?,?,?,?,?,?)`)
      .run(req.params.id, req.body?.date || todayStr(), J(scores), total, req.body?.note || null, req.user.name);
    res.json({ ok: true, total });
  });

  // ---- Sober supports / meetings ----
  app.post('/api/housing/residents/:id/support', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_supports (resident_id,date,type,detail,by) VALUES (?,?,?,?,?)`)
      .run(req.params.id, b.date || todayStr(), b.type || 'meeting', b.detail || null, req.user.name);
    res.json({ ok: true });
  });

  // ---- Drug screening ----
  app.get('/api/housing/screens', requireAuth, (req, res) => {
    const residents = db.prepare(`SELECT id,name,house_id,loc FROM housing_residents WHERE status='active'`).all();
    const recent = db.prepare(`SELECT s.*, r.name resident_name FROM housing_screens s JOIN housing_residents r ON r.id=s.resident_id ORDER BY s.date DESC, s.id DESC LIMIT 40`).all();
    const total = db.prepare(`SELECT COUNT(*) c FROM housing_screens`).get().c;
    const pos = db.prepare(`SELECT COUNT(*) c FROM housing_screens WHERE result='positive'`).get().c;
    const refused = db.prepare(`SELECT COUNT(*) c FROM housing_screens WHERE result='refused'`).get().c;
    const due = residents.filter(r => { const s = lastScreen(r.id); return !s || (Date.now() - new Date(s.date).getTime()) > 7 * 86400000; })
      .map(r => ({ ...r, last: lastScreen(r.id)?.date || null, house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '' }));
    res.json({
      due, recent,
      stats: { total, positive: pos, refused, positivityPct: total ? Math.round((pos / total) * 100) : 0 },
    });
  });

  // Random selection — pull N active residents not screened recently
  app.post('/api/housing/screens/random', requireAuth, (req, res) => {
    const n = Math.max(1, num(req.body?.n, 3));
    const houseId = req.body?.house_id ? num(req.body.house_id) : null;
    let pool = db.prepare(`SELECT id,name,house_id FROM housing_residents WHERE status='active'${houseId ? ' AND house_id=?' : ''}`).all(...(houseId ? [houseId] : []));
    pool = pool.map(r => ({ ...r, last: lastScreen(r.id)?.date || null }))
      .sort((a, b) => (a.last || '').localeCompare(b.last || '')); // least-recently screened first
    // shuffle within, then weight toward stale
    pool.sort(() => Math.random() - 0.5).sort((a, b) => (a.last || '0').localeCompare(b.last || '0'));
    res.json({ picked: pool.slice(0, n) });
  });

  app.post('/api/housing/screens', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_screens (resident_id,date,panel,observed,result,substances,scheduled,collected_by,note) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(num(b.resident_id), b.date || todayStr(), b.panel || '12-panel', b.observed ? 1 : 0, b.result || 'negative',
        b.substances || null, b.scheduled ? 1 : 0, req.user.name, b.note || null);
    // a positive screen is a "return to use" signal — log it so outcomes & the
    // recover-instantly playbook can act (a complaint/relapse is a gift).
    if (b.result === 'positive') {
      const r = db.prepare(`SELECT name,house_id FROM housing_residents WHERE id=?`).get(num(b.resident_id));
      db.prepare(`INSERT INTO housing_incidents (house_id,resident_id,date,type,severity,summary,by) VALUES (?,?,?,?,?,?,?)`)
        .run(r?.house_id || null, num(b.resident_id), b.date || todayStr(), 'Return to use', 'high', `Positive screen${b.substances ? ': ' + b.substances : ''}`, req.user.name);
    }
    audit({ user: req.user, action: 'HOUSING_SCREEN', detail: b.result, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- House Life (chores · curfew · meetings) ----
  app.get('/api/housing/houselife', requireAuth, (req, res) => {
    const houseId = num(req.query.house_id);
    const date = req.query.date || todayStr();
    if (!houseId) return res.json({ residents: [], chores: [] });
    const residents = db.prepare(`SELECT r.*, b.label bed_label FROM housing_residents r LEFT JOIN housing_beds b ON b.id=r.bed_id WHERE r.house_id=? AND r.status='active' ORDER BY r.name`).all(houseId);
    const rows = residents.map(r => ({
      id: r.id, name: r.name, bed: r.bed_label,
      curfew: db.prepare(`SELECT * FROM housing_curfew WHERE resident_id=? AND date=? ORDER BY id DESC LIMIT 1`).get(r.id, date) || null,
      chore: db.prepare(`SELECT * FROM housing_chorelog WHERE resident_id=? AND date=? ORDER BY id DESC LIMIT 1`).get(r.id, date) || null,
      meeting: db.prepare(`SELECT COUNT(*) c FROM housing_supports WHERE resident_id=? AND type='meeting' AND date=?`).get(r.id, date).c,
    }));
    res.json({ date, houseId, residents: rows });
  });

  app.post('/api/housing/curfew', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_curfew (house_id,resident_id,date,status,time,by,note) VALUES (?,?,?,?,?,?,?)`)
      .run(num(b.house_id), num(b.resident_id), b.date || todayStr(), b.status || 'in', new Date().toTimeString().slice(0, 5), req.user.name, b.note || null);
    res.json({ ok: true });
  });

  app.post('/api/housing/chore', requireAuth, (req, res) => {
    const b = req.body || {};
    const existing = db.prepare(`SELECT id FROM housing_chorelog WHERE resident_id=? AND date=?`).get(num(b.resident_id), b.date || todayStr());
    if (existing) db.prepare(`UPDATE housing_chorelog SET chore=?, done=?, by=? WHERE id=?`).run(b.chore || null, b.done ? 1 : 0, req.user.name, existing.id);
    else db.prepare(`INSERT INTO housing_chorelog (house_id,resident_id,chore,date,done,by) VALUES (?,?,?,?,?,?)`).run(num(b.house_id), num(b.resident_id), b.chore || 'House chore', b.date || todayStr(), b.done ? 1 : 0, req.user.name);
    res.json({ ok: true });
  });

  // ---- Ledger / rent ----
  app.get('/api/housing/ledger', requireAuth, (req, res) => {
    const residents = db.prepare(`SELECT id,name,house_id,payer FROM housing_residents WHERE status='active' ORDER BY name`).all()
      .map(r => ({ ...r, balance: balanceOf(r.id), house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '' }));
    const totalCharged = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM housing_ledger WHERE kind='charge'`).get().s;
    const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM housing_ledger WHERE kind='payment'`).get().s;
    const byPayer = db.prepare(`SELECT payer, COALESCE(SUM(CASE WHEN kind='charge' THEN amount ELSE 0 END),0) charged,
        COALESCE(SUM(CASE WHEN kind='payment' THEN amount ELSE 0 END),0) paid FROM housing_ledger GROUP BY payer`).all();
    const recent = db.prepare(`SELECT l.*, r.name resident_name FROM housing_ledger l JOIN housing_residents r ON r.id=l.resident_id ORDER BY l.date DESC, l.id DESC LIMIT 40`).all();
    res.json({
      residents, recent, byPayer,
      stats: { totalCharged, totalPaid, outstanding: +(residents.reduce((a, r) => a + Math.max(0, r.balance), 0)).toFixed(2) },
    });
  });

  app.post('/api/housing/ledger', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_ledger (resident_id,date,kind,amount,payer,memo,by) VALUES (?,?,?,?,?,?,?)`)
      .run(num(b.resident_id), b.date || todayStr(), b.kind || 'charge', num(b.amount), b.payer || null, b.memo || null, req.user.name);
    audit({ user: req.user, action: 'HOUSING_LEDGER', detail: `${b.kind} $${b.amount}`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Clinical coordination (PHP/IOP) ----
  app.get('/api/housing/coordination', requireAuth, (req, res) => {
    const wk = weekKey(req.query.week || todayStr());
    const residents = db.prepare(`SELECT id,name,loc,house_id,recovery_coach FROM housing_residents WHERE status='active' AND loc!='MON' ORDER BY name`).all();
    const rows = residents.map(r => {
      const target = LOC[r.loc]?.weeklyHours || 0;
      const hours = db.prepare(`SELECT COALESCE(SUM(hours),0) h FROM housing_coordination WHERE resident_id=? AND week=?`).get(r.id, wk).h;
      const lastCoc = db.prepare(`SELECT * FROM housing_coordination WHERE resident_id=? AND note IS NOT NULL ORDER BY date DESC LIMIT 1`).get(r.id);
      return {
        id: r.id, name: r.name, loc: r.loc, target, hours, coach: r.recovery_coach,
        house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '',
        pct: target ? Math.round((hours / target) * 100) : 100,
        roi: db.prepare(`SELECT COUNT(*) c FROM housing_coordination WHERE resident_id=? AND roi=1`).get(r.id).c > 0 ? 1 : 0,
        lastCoc: lastCoc ? { date: lastCoc.date, note: lastCoc.note } : null,
      };
    });
    res.json({ week: wk, rows });
  });

  app.post('/api/housing/coordination', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_coordination (resident_id,date,week,hours,kind,note,with_clinical,roi,by) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(num(b.resident_id), b.date || todayStr(), weekKey(b.date || todayStr()), num(b.hours), b.kind || null, b.note || null, b.with_clinical ? 1 : 0, b.roi ? 1 : 0, req.user.name);
    res.json({ ok: true });
  });

  // ---- ORH / NARR compliance ----
  app.get('/api/housing/orh', requireAuth, (req, res) => {
    const houses = db.prepare(`SELECT id,name,level,orh_cert FROM housing_houses WHERE active=1 ORDER BY level DESC, name`).all();
    const statusByHouse = {};
    houses.forEach(h => {
      const rows = db.prepare(`SELECT code,status,note FROM housing_orh WHERE house_id=?`).all(h.id);
      const m = {}; rows.forEach(r => m[r.code] = r);
      const level = h.level === 'L3' ? 3 : 2;
      const req2 = ORH_STANDARDS.filter(s => s[3] <= level);
      const met = req2.filter(s => m[s[1]]?.status === 'met').length;
      const partial = req2.filter(s => m[s[1]]?.status === 'partial').length;
      statusByHouse[h.id] = { map: m, pct: req2.length ? Math.round(((met + partial * 0.5) / req2.length) * 100) : 0, met, partial, total: req2.length };
    });
    const inspections = db.prepare(`SELECT i.*, h.name house_name FROM housing_inspections i JOIN housing_houses h ON h.id=i.house_id ORDER BY i.date DESC LIMIT 30`).all();
    const grievances = db.prepare(`SELECT g.*, h.name house_name, r.name resident_name FROM housing_grievances g LEFT JOIN housing_houses h ON h.id=g.house_id LEFT JOIN housing_residents r ON r.id=g.resident_id ORDER BY g.status='open' DESC, g.date DESC LIMIT 30`).all();
    res.json({ houses, standards: ORH_STANDARDS, statusByHouse, inspections, grievances });
  });

  app.post('/api/housing/orh/status', requireAuth, requireAdmin, (req, res) => {
    const b = req.body || {};
    const existing = db.prepare(`SELECT id FROM housing_orh WHERE house_id=? AND code=?`).get(num(b.house_id), b.code);
    if (existing) db.prepare(`UPDATE housing_orh SET status=?, note=?, updated_by=?, updated=datetime('now') WHERE id=?`).run(b.status, b.note ?? null, req.user.name, existing.id);
    else db.prepare(`INSERT INTO housing_orh (house_id,code,status,note,updated_by,updated) VALUES (?,?,?,?,?,datetime('now'))`).run(num(b.house_id), b.code, b.status || 'gap', b.note ?? null, req.user.name);
    res.json({ ok: true });
  });

  app.post('/api/housing/inspections', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_inspections (house_id,date,type,result,note,by) VALUES (?,?,?,?,?,?)`)
      .run(num(b.house_id), b.date || todayStr(), b.type || 'Walkthrough', b.result || 'Pass', b.note || null, req.user.name);
    res.json({ ok: true });
  });

  app.post('/api/housing/grievances', requireAuth, (req, res) => {
    const b = req.body || {};
    if (b.id) {
      db.prepare(`UPDATE housing_grievances SET status=?, resolution=? WHERE id=?`).run(b.status || 'resolved', b.resolution || null, num(b.id));
    } else {
      db.prepare(`INSERT INTO housing_grievances (house_id,resident_id,date,summary,status,by) VALUES (?,?,?,?,?,?)`)
        .run(num(b.house_id), b.resident_id ? num(b.resident_id) : null, b.date || todayStr(), b.summary || '', 'open', req.user.name);
    }
    res.json({ ok: true });
  });

  // ---- Incident reports (housing) ----
  app.get('/api/housing/incidents', requireAuth, (req, res) => {
    const status = req.query.status || 'all';
    const where = status === 'all' ? '' : `WHERE i.status=?`;
    const rows = (status === 'all'
      ? db.prepare(`SELECT i.*, h.name house_name, r.name resident_name FROM housing_incidents i LEFT JOIN housing_houses h ON h.id=i.house_id LEFT JOIN housing_residents r ON r.id=i.resident_id ORDER BY i.date DESC, i.id DESC LIMIT 200`).all()
      : db.prepare(`SELECT i.*, h.name house_name, r.name resident_name FROM housing_incidents i LEFT JOIN housing_houses h ON h.id=i.house_id LEFT JOIN housing_residents r ON r.id=i.resident_id ${where} ORDER BY i.date DESC, i.id DESC LIMIT 200`).all(status));
    const open = db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE status='open'`).get().c;
    const high = db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE severity='high'`).get().c;
    const monthStart = todayStr().slice(0, 8) + '01';
    const month = db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE date>=?`).get(monthStart).c;
    res.json({ rows, types: HOUSING_INCIDENT_TYPES, stats: { open, high, month, total: rows.length } });
  });

  app.post('/api/housing/incidents', requireAuth, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`INSERT INTO housing_incidents (house_id,resident_id,date,time,type,severity,summary,action,notified,follow_up,status,reported_by,by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.house_id ? num(b.house_id) : null, b.resident_id ? num(b.resident_id) : null, b.date || todayStr(), b.time || null,
      b.type || 'Other', b.severity || 'low', b.summary || '', b.action || null, b.notified || null, b.follow_up || null,
      b.status || 'open', b.reported_by || req.user.name, req.user.name);
    audit({ user: req.user, action: 'HOUSING_INCIDENT', detail: `${b.type || 'Other'} (${b.severity || 'low'})`, ip: req.ip });
    if (/high|critical/i.test(b.severity || '')) {
      const where = b.house_id ? (db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(num(b.house_id))?.name || '') : '';
      const who = b.resident_id ? (db.prepare(`SELECT name FROM housing_residents WHERE id=?`).get(num(b.resident_id))?.name || '') : '';
      alertHousing(`🚨 ${b.severity} incident — ${b.type || 'Incident'}${where ? ' · ' + where : ''}`, `${b.severity}-severity incident`,
        `<p>A <b>${(b.severity || '').toLowerCase()}</b>-severity incident was logged${where ? ' at <b>' + where + '</b>' : ''}${who ? ' involving <b>' + who + '</b>' : ''}:</p>
         <p style="font-size:16px"><b>${(b.type || 'Incident').replace(/[<>&]/g, '')}</b> — ${(b.summary || '').replace(/[<>&]/g, '')}</p>${b.action ? '<p style="color:' + EM.soft + '">Action: ' + (b.action).replace(/[<>&]/g, '') + '</p>' : ''}`);
    }
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  app.post('/api/housing/incidents/:id', requireAuth, (req, res) => {
    const b = req.body || {};
    const cur = db.prepare(`SELECT * FROM housing_incidents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const f = (k, d) => (b[k] !== undefined ? b[k] : d);
    db.prepare(`UPDATE housing_incidents SET type=?,severity=?,summary=?,action=?,notified=?,follow_up=?,status=? WHERE id=?`)
      .run(f('type', cur.type), f('severity', cur.severity), f('summary', cur.summary), f('action', cur.action), f('notified', cur.notified), f('follow_up', cur.follow_up), f('status', cur.status), req.params.id);
    res.json({ ok: true });
  });

  // ---- Staffing / shift coverage ----
  app.get('/api/housing/staffing', requireAuth, (req, res) => {
    const date = req.query.date || todayStr();
    const houses = db.prepare(`SELECT id,name,program,level FROM housing_houses WHERE active=1 ORDER BY level DESC, name`).all();
    const assigns = db.prepare(`SELECT * FROM housing_staff_shifts WHERE date=?`).all(date);
    const grid = {};
    houses.forEach(h => { grid[h.id] = {}; HOUSING_SHIFTS.forEach(s => grid[h.id][s] = []); });
    assigns.forEach(a => { if (grid[a.house_id] && grid[a.house_id][a.shift]) grid[a.house_id][a.shift].push(a); });
    const staff = db.prepare(`SELECT id,name,job_role FROM users WHERE active=1 AND (role='admin' OR job_role IN ('Housing Director','House Manager','Recovery Coach')) ORDER BY name`).all();
    const gaps = [];
    houses.forEach(h => HOUSING_SHIFTS.forEach(s => { if (!grid[h.id][s].length) gaps.push(`${h.name} · ${s}`); }));
    res.json({ date, shifts: HOUSING_SHIFTS, houses, grid, staff, gaps });
  });

  app.post('/api/housing/staffing', requireAuth, (req, res) => {
    const b = req.body || {};
    const u = b.user_id ? db.prepare(`SELECT name,job_role FROM users WHERE id=?`).get(num(b.user_id)) : null;
    db.prepare(`INSERT INTO housing_staff_shifts (house_id,date,shift,user_id,staff_name,role,status,by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(num(b.house_id), b.date || todayStr(), b.shift || 'Day', b.user_id ? num(b.user_id) : null, u?.name || b.staff_name || 'Staff', u?.job_role || b.role || null, b.status || 'scheduled', req.user.name);
    res.json({ ok: true });
  });

  app.post('/api/housing/staffing/:id', requireAuth, (req, res) => {
    db.prepare(`UPDATE housing_staff_shifts SET status=? WHERE id=?`).run(req.body?.status || 'scheduled', req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/housing/staffing/:id', requireAuth, (req, res) => { db.prepare(`DELETE FROM housing_staff_shifts WHERE id=?`).run(req.params.id); res.json({ ok: true }); });

  // ---- Shift reports ----
  app.get('/api/housing/shiftreports', requireAuth, (req, res) => {
    const houseId = req.query.house_id ? num(req.query.house_id) : null;
    const rows = (houseId
      ? db.prepare(`SELECT s.*, h.name house_name FROM housing_shift_reports s LEFT JOIN housing_houses h ON h.id=s.house_id WHERE s.house_id=? ORDER BY s.date DESC, s.id DESC LIMIT 60`).all(houseId)
      : db.prepare(`SELECT s.*, h.name house_name FROM housing_shift_reports s LEFT JOIN housing_houses h ON h.id=s.house_id ORDER BY s.date DESC, s.id DESC LIMIT 60`).all())
      .map(r => ({ ...r, safety: P(r.safety, {}) }));
    const houses = db.prepare(`SELECT id,name,program FROM housing_houses WHERE active=1 ORDER BY level DESC, name`).all();
    // which house/shift still needs a report today
    const today = todayStr();
    const doneToday = {}; db.prepare(`SELECT house_id,shift FROM housing_shift_reports WHERE date=?`).all(today).forEach(r => doneToday[r.house_id + '|' + r.shift] = 1);
    const missing = [];
    houses.forEach(h => HOUSING_SHIFTS.forEach(s => { if (!doneToday[h.id + '|' + s]) missing.push(`${h.name} · ${s}`); }));
    res.json({ rows, houses, shifts: HOUSING_SHIFTS, missingToday: missing });
  });

  app.post('/api/housing/shiftreports', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_shift_reports (house_id,date,shift,on_duty,present_count,expected_count,out_residents,meds_note,safety,summary,handoff,escalation,by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      num(b.house_id), b.date || todayStr(), b.shift || 'Day', b.on_duty || req.user.name,
      b.present_count != null ? num(b.present_count) : null, b.expected_count != null ? num(b.expected_count) : null,
      b.out_residents || null, b.meds_note || null, J(b.safety || {}), b.summary || null, b.handoff || null,
      b.escalation ? 1 : 0, req.user.name);
    audit({ user: req.user, action: 'HOUSING_SHIFT_REPORT', detail: `${b.shift} report`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Intake & forms ----

  // ---- Intake & forms ----
  app.get('/api/housing/forms/templates', requireAuth, (req, res) => res.json({ templates: FORM_TEMPLATES }));

  // Intake roster — who still has an incomplete packet
  app.get('/api/housing/intake', requireAuth, (req, res) => {
    const residents = db.prepare(`SELECT id,name,house_id,loc,move_in,status FROM housing_residents WHERE status IN ('active','waitlist') ORDER BY move_in DESC`).all();
    const rows = residents.map(r => ({
      ...r, house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '',
      packet: packetStatus(r.id),
    }));
    res.json({ templates: FORM_TEMPLATES, residents: rows });
  });

  // Save / sign one form for a resident
  app.post('/api/housing/residents/:id/forms', requireAuth, (req, res) => {
    const b = req.body || {};
    const tmpl = FORM_TEMPLATES.find(t => t.type === b.type);
    if (!tmpl) return res.status(400).json({ error: 'Unknown form' });
    const status = b.sign ? 'complete' : (b.status || 'in_progress');
    const existing = db.prepare(`SELECT id FROM housing_forms WHERE resident_id=? AND type=?`).get(req.params.id, b.type);
    if (existing) {
      db.prepare(`UPDATE housing_forms SET data=?, status=?, signed_by=?, signed_date=?, staff=?, updated=datetime('now') WHERE id=?`)
        .run(J(b.data || {}), status, b.sign ? (b.signed_by || null) : null, b.sign ? (b.signed_date || todayStr()) : null, req.user.name, existing.id);
    } else {
      db.prepare(`INSERT INTO housing_forms (resident_id,type,data,status,signed_by,signed_date,staff,updated) VALUES (?,?,?,?,?,?,?,datetime('now'))`)
        .run(req.params.id, b.type, J(b.data || {}), status, b.sign ? (b.signed_by || null) : null, b.sign ? (b.signed_date || todayStr()) : null, req.user.name);
    }
    // The financial agreement seeds the payment plan automatically.
    if (b.type === 'financial_agreement' && b.sign && b.data) {
      const d = b.data;
      db.prepare(`UPDATE housing_payplans SET active=0 WHERE resident_id=?`).run(req.params.id);
      db.prepare(`INSERT INTO housing_payplans (resident_id,weekly_amount,due_day,source,arrangement,deposit,start_date,active,by) VALUES (?,?,?,?,?,?,?,1,?)`)
        .run(req.params.id, num(d.weekly_fee), d.due_day || null, d.source || null, d.payment_plan || null, num(d.deposit), todayStr(), req.user.name);
    }
    audit({ user: req.user, action: 'HOUSING_FORM', detail: `${b.type}${b.sign ? ' signed' : ''}`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Payment plan ----
  app.post('/api/housing/residents/:id/payplan', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`UPDATE housing_payplans SET active=0 WHERE resident_id=?`).run(req.params.id);
    db.prepare(`INSERT INTO housing_payplans (resident_id,weekly_amount,due_day,source,arrangement,deposit,start_date,active,by) VALUES (?,?,?,?,?,?,?,1,?)`)
      .run(req.params.id, num(b.weekly_amount), b.due_day || null, b.source || null, b.arrangement || null, num(b.deposit), b.start_date || todayStr(), req.user.name);
    audit({ user: req.user, action: 'HOUSING_PAYPLAN', detail: `$${b.weekly_amount}/wk`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Rent Run (documented weekly collection) ----
  app.get('/api/housing/rentrun', requireAuth, (req, res) => {
    const wk = weekKey(req.query.week || todayStr());
    const residents = db.prepare(`SELECT id,name,house_id,payer FROM housing_residents WHERE status='active' ORDER BY name`).all();
    const rows = residents.map(r => {
      const plan = currentPayplan(r.id);
      const log = db.prepare(`SELECT * FROM housing_rentlog WHERE resident_id=? AND week=? ORDER BY id DESC LIMIT 1`).get(r.id, wk);
      return {
        id: r.id, name: r.name, house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '',
        due: plan ? plan.weekly_amount : 0, dueDay: plan?.due_day || '', source: plan?.source || r.payer || '',
        arrangement: plan?.arrangement || '', hasPlan: !!plan, balance: balanceOf(r.id),
        log: log || null,
      };
    });
    const collected = db.prepare(`SELECT COALESCE(SUM(collected),0) s FROM housing_rentlog WHERE week=?`).get(wk).s;
    const expected = rows.reduce((a, r) => a + (r.due || 0), 0);
    const worked = rows.filter(r => r.log).length;
    res.json({ week: wk, rows, stats: { expected, collected, worked, total: rows.length, noPlan: rows.filter(r => !r.hasPlan).length } });
  });

  app.post('/api/housing/rentrun', requireAuth, (req, res) => {
    const b = req.body || {};
    const wk = weekKey(b.week || todayStr());
    const rid = num(b.resident_id);
    const existing = db.prepare(`SELECT id FROM housing_rentlog WHERE resident_id=? AND week=?`).get(rid, wk);
    if (existing) db.prepare(`UPDATE housing_rentlog SET due=?, collected=?, status=?, promise_date=?, note=?, by=?, date=? WHERE id=?`)
      .run(num(b.due), num(b.collected), b.status || null, b.promise_date || null, b.note || null, req.user.name, todayStr(), existing.id);
    else db.prepare(`INSERT INTO housing_rentlog (resident_id,week,due,collected,status,promise_date,note,by,date) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(rid, wk, num(b.due), num(b.collected), b.status || null, b.promise_date || null, b.note || null, req.user.name, todayStr());
    // a real collection posts to the ledger
    if (num(b.collected) > 0 && b.post !== false) {
      db.prepare(`INSERT INTO housing_ledger (resident_id,date,kind,amount,payer,memo,by) VALUES (?,?,?,?,?,?,?)`)
        .run(rid, todayStr(), 'payment', num(b.collected), b.source || null, `Weekly rent (${wk})`, req.user.name);
    }
    audit({ user: req.user, action: 'HOUSING_RENT', detail: `${b.status} $${b.collected}`, ip: req.ip });
    res.json({ ok: true });
  });

  // ---- Employment & job search ----
  app.get('/api/housing/employment', requireAuth, (req, res) => {
    const residents = db.prepare(`SELECT id,name,house_id FROM housing_residents WHERE status='active' ORDER BY name`).all();
    const rows = residents.map(r => {
      const e = currentEmployment(r.id);
      const wk = jobsearchThisWeek(r.id);
      const seeking = !e || /seeking|unemployed/i.test(e.status || '');
      return {
        id: r.id, name: r.name, house: db.prepare(`SELECT name FROM housing_houses WHERE id=?`).get(r.house_id)?.name || '',
        status: e?.status || 'Not assessed', employer: e?.employer || '', goal: e?.goal || '',
        target: e?.weekly_target ?? 5, jobSearchWk: wk, seeking,
        lastActivity: db.prepare(`SELECT date,activity,employer FROM housing_jobsearch WHERE resident_id=? ORDER BY date DESC LIMIT 1`).get(r.id) || null,
      };
    });
    const employed = rows.filter(r => /employed|self-employed/i.test(r.status) && !/unemployed/i.test(r.status)).length;
    const seekingCount = rows.filter(r => r.seeking).length;
    const behind = rows.filter(r => r.seeking && r.jobSearchWk < r.target).length;
    res.json({ rows, stats: { total: rows.length, employed, seeking: seekingCount, behind } });
  });

  app.post('/api/housing/residents/:id/employment', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_employment (resident_id,status,employer,position,wage,hours,goal,weekly_target,note,by,date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, b.status || null, b.employer || null, b.position || null, b.wage || null, b.hours || null, b.goal || null, num(b.weekly_target, 5), b.note || null, req.user.name, b.date || todayStr());
    // keep the resident summary field in sync for rosters
    db.prepare(`UPDATE housing_residents SET employment=? WHERE id=?`).run(b.employer ? `${b.status} — ${b.employer}` : (b.status || null), req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/housing/residents/:id/jobsearch', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_jobsearch (resident_id,date,activity,employer,detail,outcome,by) VALUES (?,?,?,?,?,?,?)`)
      .run(req.params.id, b.date || todayStr(), b.activity || 'Application submitted', b.employer || null, b.detail || null, b.outcome || null, req.user.name);
    res.json({ ok: true });
  });

  // ---- Outcomes ----
  app.get('/api/housing/outcomes', requireAuth, (req, res) => {
    const all = db.prepare(`SELECT * FROM housing_residents`).all();
    const active = all.filter(r => r.status === 'active');
    const discharged = all.filter(r => r.status === 'discharged');
    // length of stay (active + discharged)
    const losList = all.filter(r => r.move_in).map(r => r.discharge_date ? Math.round((new Date(r.discharge_date) - new Date(r.move_in)) / 86400000) : losDays(r.move_in)).filter(n => n >= 0);
    const avgLos = losList.length ? Math.round(losList.reduce((a, b) => a + b, 0) / losList.length) : 0;
    // retention: of those who reached the milestone window, what % stayed
    const retained = (days) => {
      const eligible = all.filter(r => r.move_in && (Date.now() - new Date(r.move_in)) >= days * 86400000);
      if (!eligible.length) return null;
      const stayed = eligible.filter(r => { const end = r.discharge_date ? new Date(r.discharge_date) : new Date(); return (end - new Date(r.move_in)) / 86400000 >= days; });
      return Math.round((stayed.length / eligible.length) * 100);
    };
    // recovery capital growth: first vs latest per resident
    const growth = [];
    all.forEach(r => {
      const caps = db.prepare(`SELECT total FROM housing_reccap WHERE resident_id=? ORDER BY date`).all(r.id);
      if (caps.length >= 1) growth.push({ first: caps[0].total, last: caps[caps.length - 1].total });
    });
    const avgFirst = growth.length ? +(growth.reduce((a, g) => a + g.first, 0) / growth.length).toFixed(1) : null;
    const avgLast = growth.length ? +(growth.reduce((a, g) => a + g.last, 0) / growth.length).toFixed(1) : null;
    // employment rate (active)
    const employed = active.filter(r => r.employment && !/^(no|unem|not|job search)/i.test(r.employment.trim())).length;
    const emplRate = active.length ? Math.round((employed / active.length) * 100) : 0;
    // discharge dispositions
    const dispo = {};
    discharged.forEach(r => { const t = r.discharge_type || 'Unknown'; dispo[t] = (dispo[t] || 0) + 1; });
    // returns to use (all-time)
    const returns = db.prepare(`SELECT COUNT(*) c FROM housing_incidents WHERE type='Return to use'`).get().c;
    res.json({
      avgLos, active: active.length, discharged: discharged.length,
      retention: { d30: retained(30), d90: retained(90), d180: retained(180) },
      reccap: { first: avgFirst, last: avgLast, delta: (avgFirst != null && avgLast != null) ? +(avgLast - avgFirst).toFixed(1) : null },
      emplRate, employed, dispo, returns,
    });
  });
}

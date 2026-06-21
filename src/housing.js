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

import { db, audit, getState, setState } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';

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
  `);
  // Migration: program (PHP / IOP / Graduate) per house, added after first ship.
  try { db.exec(`ALTER TABLE housing_houses ADD COLUMN program TEXT`); } catch { /* already exists */ }
  // Migration: richer incident reports.
  for (const col of ['time TEXT', 'status TEXT', 'notified TEXT', 'reported_by TEXT', 'follow_up TEXT']) {
    try { db.exec(`ALTER TABLE housing_incidents ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
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
  return res.status(403).json({ error: 'Recovery Housing is restricted to housing staff.' });
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
  // Gate the entire /api/housing surface to housing staff + admin/ED (defense in
  // depth — the front-end already hides it, this stops direct API access too).
  app.use('/api/housing', requireAuth, requireHousing);

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
    const cur = db.prepare(`SELECT id, name FROM housing_residents WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    let photo = req.body?.photo ?? null;
    if (photo !== null) {
      if (typeof photo !== 'string' || !/^data:image\/[\w.+-]+;base64,/.test(photo)) return res.status(400).json({ error: 'Expected an image.' });
      if (photo.length > 3_000_000) return res.status(413).json({ error: 'Image too large — it should resize client-side first.' });
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

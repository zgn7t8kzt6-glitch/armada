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

import { db, audit } from './db.js';
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
  `);
}

/* ───────────────────────── Seed (sample so it looks alive) ───────────────────────── */

export function seedHousing() {
  const has = db.prepare(`SELECT COUNT(*) c FROM housing_houses`).get().c;
  if (has) return 0;

  const mkHouse = db.prepare(`INSERT INTO housing_houses (name,level,orh_cert,address,city,gender,mat_friendly,capacity,manager,phone,opened,color,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const houses = [
    ['Cuyahoga House', 'L3', 'ORH-OH-2024-0142', '418 Marshall Ave', 'Akron', 'Men', 1, 10, 'Marcus Webb', '330-555-0142', '2023-03-01', '#235056', 'Flagship Level 3, paired with PHP/IOP at Armada clinical.'],
    ['Summit House',   'L3', 'ORH-OH-2024-0157', '92 Crestline Dr',  'Akron', 'Women', 1, 8, 'Renee Adkins', '330-555-0157', '2023-08-15', '#5fb0c2', 'Women’s Level 3; trauma-informed, MAT-supportive.'],
    ['Towpath House',  'L2', 'ORH-OH-2025-0203', '1140 Canal St',    'Akron', 'Men', 1, 12, 'Darnell Price', '330-555-0203', '2024-11-01', '#a7ba86', 'Level 2 step-down for residents earning independence.'],
  ];
  const houseIds = houses.map(h => Number(mkHouse.run(...h).lastInsertRowid));

  // Beds
  const mkBed = db.prepare(`INSERT INTO housing_beds (house_id,room,label,status) VALUES (?,?,?,?)`);
  const capPlan = [10, 8, 12];
  const bedIds = {};
  houseIds.forEach((hid, i) => {
    bedIds[hid] = [];
    for (let r = 1; r <= Math.ceil(capPlan[i] / 2); r++) {
      for (const b of ['A', 'B']) {
        if (bedIds[hid].length >= capPlan[i]) break;
        const room = String(r).padStart(2, '0');
        bedIds[hid].push(Number(mkBed.run(hid, room, room + b, 'open').lastInsertRowid));
      }
    }
  });

  // Residents (de-identified sample) + occupy beds
  const mkRes = db.prepare(`INSERT INTO housing_residents
    (name,house_id,bed_id,loc,phase,status,move_in,sober_date,recovery_coach,payer,employment,mat,sponsor,home_group,goals)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const setBed = db.prepare(`UPDATE housing_beds SET status='occupied', resident_id=? WHERE id=?`);
  const setResBed = db.prepare(`UPDATE housing_residents SET bed_id=? WHERE id=?`);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const sample = [
    ['Jordan M.', 0, 'PHP', 1, daysAgo(8),  daysAgo(20),  'Marcus Webb', 'SOR scholarship', 'Job searching', 'Suboxone', 'Not yet', 'Tuesday Big Book', 'Get to 90 days; reconnect with daughter'],
    ['Andre T.',  0, 'IOP', 2, daysAgo(34), daysAgo(50),  'Marcus Webb', 'Medicaid',        'Part-time — warehouse', 'Vivitrol', 'Ray K.', 'Men’s Step Study', 'Full-time work; driver’s license back'],
    ['Chris B.',  0, 'IOP', 3, daysAgo(67), daysAgo(96),  'Marcus Webb', 'Self-pay',        'Full-time — line cook', 'None', 'Tom V.', 'Sunrise Group', 'Save for apartment; sponsor a newcomer'],
    ['Maria S.',  1, 'PHP', 1, daysAgo(11), daysAgo(15),  'Renee Adkins', 'SOR scholarship', 'Unemployed', 'Suboxone', 'Not yet', 'Women’s Serenity', 'Stabilize; safety plan; childcare'],
    ['Tonya R.',  1, 'IOP', 2, daysAgo(41), daysAgo(63),  'Renee Adkins', 'Private — Anthem', 'Part-time — retail', 'None', 'Gail P.', 'Women’s Serenity', 'GED; rebuild trust with family'],
    ['Latoya W.', 1, 'OP',  3, daysAgo(78), daysAgo(120), 'Renee Adkins', 'Self-pay',        'Full-time — CNA', 'None', 'Denise M.', 'Hope & Healing', 'Transition to own place; mentor'],
    ['Devon H.',  2, 'OP',  4, daysAgo(120),daysAgo(150), 'Darnell Price', 'Self-pay',       'Full-time — logistics', 'None', 'Phil R.', 'Towpath Nooners', 'Move to independent housing this month'],
    ['Marcus L.', 2, 'IOP', 3, daysAgo(55), daysAgo(70),  'Darnell Price', 'Medicaid',        'Apprenticeship — HVAC', 'Vivitrol', 'Sam D.', 'Towpath Nooners', 'Finish apprenticeship; rebuild credit'],
  ];
  const resIds = [];
  sample.forEach((s, i) => {
    const hid = houseIds[s[1]];
    const rid = Number(mkRes.run(s[0], hid, null, s[2], s[3], 'active', s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12]).lastInsertRowid);
    resIds.push(rid);
    const bed = bedIds[hid].find(bId => db.prepare(`SELECT status FROM housing_beds WHERE id=?`).get(bId).status === 'open');
    if (bed) { setBed.run(rid, bed); setResBed.run(bed, rid); }
  });

  // Recovery-capital baselines, supports, screens, ledger, coordination
  const mkCap = db.prepare(`INSERT INTO housing_reccap (resident_id,date,scores,total,by,note) VALUES (?,?,?,?,?,?)`);
  const mkSup = db.prepare(`INSERT INTO housing_supports (resident_id,date,type,detail,by) VALUES (?,?,?,?,?)`);
  const mkScr = db.prepare(`INSERT INTO housing_screens (resident_id,date,panel,observed,result,scheduled,collected_by) VALUES (?,?,?,?,?,?,?)`);
  const mkLed = db.prepare(`INSERT INTO housing_ledger (resident_id,date,kind,amount,payer,memo,by) VALUES (?,?,?,?,?,?,?)`);
  const mkCoord = db.prepare(`INSERT INTO housing_coordination (resident_id,date,week,hours,kind,with_clinical,roi,by,note) VALUES (?,?,?,?,?,?,?,?,?)`);
  const weekKey = (d) => { const dt = new Date(d); const day = dt.getDay(); dt.setDate(dt.getDate() - day); return dt.toISOString().slice(0, 10); };
  resIds.forEach((rid, i) => {
    const base = 4 + (i % 5);
    const scores = {}; let tot = 0;
    RECCAP_DOMAINS.forEach((d, j) => { const v = Math.max(2, Math.min(9, base + ((i + j) % 4) - 1)); scores[d[0]] = v; tot += v; });
    mkCap.run(rid, daysAgo(7), J(scores), +(tot / RECCAP_DOMAINS.length).toFixed(1), 'system', 'Baseline assessment');
    mkSup.run(rid, daysAgo(2), 'meeting', '12-step meeting', 'system');
    mkSup.run(rid, daysAgo(5), 'meeting', 'Home group', 'system');
    mkScr.run(rid, daysAgo(3), '12-panel', 1, 'negative', 1, 'House staff');
    mkLed.run(rid, daysAgo(7), 'charge', 175, sample[i][6], 'Weekly bed fee', 'system');
    if (i % 3 === 0) mkLed.run(rid, daysAgo(3), 'payment', 175, sample[i][6], 'Weekly bed fee paid', 'system');
    const loc = sample[i][2];
    const target = LOC[loc]?.weeklyHours || 0;
    if (target) mkCoord.run(rid, daysAgo(1), weekKey(todayStr()), Math.max(0, target - (i % 3) * 2), loc, 1, 1, 'system', 'Attended scheduled groups at Armada clinical');
  });

  // ORH status per house (mostly met on L3 flagships, gaps on the newer L2)
  const mkOrh = db.prepare(`INSERT INTO housing_orh (house_id,code,status,updated_by,updated) VALUES (?,?,?,?,?)`);
  houseIds.forEach((hid, i) => {
    const level = i === 2 ? 2 : 3;
    ORH_STANDARDS.forEach((s, j) => {
      if (s[3] > level) return; // not required at this level
      const status = (i === 2 && j % 5 === 0) ? 'partial' : (j % 11 === 0 ? 'gap' : 'met');
      mkOrh.run(hid, s[1], status, 'system', daysAgo(14));
    });
  });

  // Inspections
  const mkIns = db.prepare(`INSERT INTO housing_inspections (house_id,date,type,result,note,by) VALUES (?,?,?,?,?,?)`);
  houseIds.forEach((hid) => {
    mkIns.run(hid, daysAgo(40), 'Fire & safety', 'Pass', 'Annual fire inspection — detectors & extinguishers OK', 'system');
    mkIns.run(hid, daysAgo(10), 'House walkthrough', 'Pass', 'Monthly walkthrough — clean, in good repair', 'system');
  });

  // Payment plans, employment, job-search, and a partial intake packet per resident
  const mkPlan = db.prepare(`INSERT INTO housing_payplans (resident_id,weekly_amount,due_day,source,arrangement,deposit,start_date,active,by) VALUES (?,?,?,?,?,?,?,1,?)`);
  const mkEmp = db.prepare(`INSERT INTO housing_employment (resident_id,status,employer,position,wage,hours,goal,weekly_target,by,date) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const mkJob = db.prepare(`INSERT INTO housing_jobsearch (resident_id,date,activity,employer,detail,by) VALUES (?,?,?,?,?,?)`);
  const mkRent = db.prepare(`INSERT INTO housing_rentlog (resident_id,week,due,collected,status,note,by,date) VALUES (?,?,?,?,?,?,?,?)`);
  const mkForm = db.prepare(`INSERT INTO housing_forms (resident_id,type,data,status,signed_by,signed_date,staff,updated) VALUES (?,?,?,?,?,?,?,datetime('now'))`);
  const empPlan = [
    ['Unemployed — actively seeking', '', 'Land part-time work within 30 days', 5],
    ['Employed — part-time', 'Summit Warehouse', 'Move to full-time', 3],
    ['Employed — full-time', 'Akron Bistro', 'Save 1 month rent', 1],
    ['Unemployed — actively seeking', '', 'Resume + 3 applications/week', 5],
    ['Employed — part-time', 'Towpath Retail', 'GED then full-time', 3],
    ['Employed — full-time', 'Mercy CNA', 'Keep CNA license active', 1],
    ['Employed — full-time', 'Pratt Logistics', 'Independent apartment', 1],
    ['In school / training', 'HVAC apprenticeship', 'Finish apprenticeship', 2],
  ];
  resIds.forEach((rid, i) => {
    mkPlan.run(rid, 175, 'Friday', sample[i][6], `Pays $175 every Friday from ${/employ|warehouse|cook|cna|logistics|hvac|retail/i.test(sample[i][8]) ? 'paycheck (direct from employer pay day)' : 'scholarship + family until employed'}. Promise-to-pay allowed once/month with a documented catch-up date.`, 175, daysAgo(30), 'system');
    const e = empPlan[i % empPlan.length];
    mkEmp.run(rid, e[0], e[1], e[1] ? 'Staff' : '', e[1] ? '$15/hr' : '', e[1] ? '24/wk' : '', e[2], e[3], 'system', daysAgo(7));
    if (/seeking/i.test(e[0])) { mkJob.run(rid, daysAgo(2), 'Application submitted', 'Local employer', 'Applied online', 'system'); mkJob.run(rid, daysAgo(5), 'Resume / cover letter', '', 'Updated resume with coach', 'system'); }
    // current-week rent: most paid, a couple promise-to-pay
    const wkNow = weekKey(todayStr());
    if (i % 4 === 0) mkRent.run(rid, wkNow, 175, 0, 'Promise to pay', 'Payday Friday — will pay full', 'system', todayStr());
    else if (i % 3 !== 1) { mkRent.run(rid, wkNow, 175, 175, 'Paid', 'Paid in full', 'system', todayStr()); }
    // intake packet: first ~5 residents fully signed, rest partial (shows the gap)
    const signCount = i < 5 ? FORM_TEMPLATES.length : 3;
    FORM_TEMPLATES.slice(0, signCount).forEach(t => mkForm.run(rid, t.type, J({}), 'complete', sample[i][0], daysAgo(20 - i), 'system'));
  });

  return houseIds.length;
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
  return {
    ...r,
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
  try { seedHousing(); } catch (e) { console.error('[housing] seed:', e.message); }
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
    const occupied = residents.length;
    const byLoc = {}; Object.keys(LOC).forEach(k => byLoc[k] = 0);
    residents.forEach(r => { byLoc[r.loc] = (byLoc[r.loc] || 0) + 1; });
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

    res.json({
      kpis: {
        houses: houses.length, capacity, occupied, open: Math.max(0, capacity - occupied),
        occPct: capacity ? Math.round((occupied / capacity) * 100) : 0,
        reccapAvg, balanceOut, screensDue, underDose, orhPct, returnsToUse, grievOpen,
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
    const r = db.prepare(`INSERT INTO housing_houses (name,level,orh_cert,address,city,gender,mat_friendly,capacity,manager,phone,opened,color,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      (b.name || 'New House').trim(), b.level || 'L2', b.orh_cert || null, b.address || null, b.city || null,
      b.gender || 'Any', b.mat_friendly ? 1 : 0, num(b.capacity), b.manager || null, b.phone || null,
      b.opened || null, b.color || null, b.notes || null);
    audit({ user: req.user, action: 'HOUSING_HOUSE_ADD', detail: b.name, ip: req.ip });
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  app.post('/api/housing/houses/:id', requireAuth, requireAdmin, (req, res) => {
    const b = req.body || {};
    const cur = db.prepare(`SELECT * FROM housing_houses WHERE id=?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const f = (k, d) => (b[k] !== undefined ? b[k] : d);
    db.prepare(`UPDATE housing_houses SET name=?,level=?,orh_cert=?,address=?,city=?,gender=?,mat_friendly=?,capacity=?,manager=?,phone=?,opened=?,color=?,notes=?,active=? WHERE id=?`)
      .run(f('name', cur.name), f('level', cur.level), f('orh_cert', cur.orh_cert), f('address', cur.address), f('city', cur.city),
        f('gender', cur.gender), b.mat_friendly !== undefined ? (b.mat_friendly ? 1 : 0) : cur.mat_friendly, num(f('capacity', cur.capacity)),
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

  // ---- Incidents (housing) ----
  app.post('/api/housing/incidents', requireAuth, (req, res) => {
    const b = req.body || {};
    db.prepare(`INSERT INTO housing_incidents (house_id,resident_id,date,type,severity,summary,action,by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(b.house_id ? num(b.house_id) : null, b.resident_id ? num(b.resident_id) : null, b.date || todayStr(), b.type || 'Other', b.severity || 'low', b.summary || '', b.action || null, req.user.name);
    res.json({ ok: true });
  });

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

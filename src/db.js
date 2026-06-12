// SQLite data layer using Node's built-in node:sqlite.
// All persistent state lives here. Designed so the DB file can be swapped for a
// managed Postgres in production without changing route logic much.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ARMADA_DB || path.join(__dirname, '..', 'data', 'armada.db');

// Ensure data dir exists
import fs from 'node:fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',          -- 'admin' | 'staff'
  job_role TEXT NOT NULL DEFAULT 'BHT / Tech', -- BHT / Tech | Nurse | Therapist | Kitchen
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pref TEXT, room TEXT, program TEXT,
  admit TEXT, sober TEXT,
  touch TEXT, prefs TEXT, goals TEXT, triggers TEXT, safety TEXT, support TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  shift TEXT NOT NULL,      -- Morning | Day | Evening | Night
  job_role TEXT NOT NULL,   -- All | BHT / Tech | Nurse | Therapist | Kitchen
  text TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',
  sort INTEGER NOT NULL DEFAULT 0
);

-- A specific shift on a specific date (the "daily lineup" instance)
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,       -- YYYY-MM-DD
  name TEXT NOT NULL,       -- Morning | Day | Evening | Night
  UNIQUE(date, name)
);

-- Which staff member is assigned to a shift
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(shift_id, user_id)
);

-- Task completion tied to a shift instance
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  done_by INTEGER REFERENCES users(id),
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shift_id, task_id)
);

-- End-of-shift handoff notes per client
CREATE TABLE IF NOT EXISTS handoffs (
  id INTEGER PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily Pulse: a quick per-shift check-in capturing AMA (against-medical-advice)
-- warning signs for each client.
CREATE TABLE IF NOT EXISTS pulses (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift TEXT NOT NULL,
  concern TEXT NOT NULL DEFAULT 'Low',   -- Low | Medium | High (staff gut-check)
  engagement TEXT,                        -- Engaged | Quiet | Withdrawn | Missed group
  triggers TEXT,                          -- JSON array of observed warning-sign tags
  statements TEXT,                        -- notable direct quotes
  note TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Claude's AMA risk read for a client — clinical decision support, reviewed by staff.
CREATE TABLE IF NOT EXISTS ama_reads (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  level TEXT NOT NULL,        -- Low | Elevated | High
  summary TEXT,
  triggers TEXT,             -- JSON array
  actions TEXT,              -- JSON array of {shift, job_role, text}
  approach TEXT,
  underlying TEXT,           -- the real emotional reason beneath the complaint
  cared_for TEXT,            -- JSON array of personalized "feel cared for" gestures
  best_play TEXT,            -- the single best move to retain this client now
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aftercare / continuity-of-care follow-up calls (the "fond farewell").
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                     -- 24h | 48h | 30d | custom
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending', -- Pending | Done | Unreachable
  note TEXT,
  done_by INTEGER REFERENCES users(id),
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Concern/defect ownership (lateral service): whoever hears it owns it.
CREATE TABLE IF NOT EXISTS concerns (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id),
  owner_name TEXT,
  status TEXT NOT NULL DEFAULT 'Open',    -- Open | Resolved
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- "Whatever it takes" delight log (the $2,000 rule).
CREATE TABLE IF NOT EXISTS delights (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wow Stories / moments-of-care recognition (the Daily Lineup culture).
CREATE TABLE IF NOT EXISTS wows (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  recognize TEXT,                          -- staff member being recognized
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Staff wellbeing pulse ("Ladies and Gentlemen serving Ladies and Gentlemen").
CREATE TABLE IF NOT EXISTS staff_pulses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  load TEXT,                               -- Good | Okay | Stretched | Burnt out
  note TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Client-voiced experience: "how cared for do you feel?"
CREATE TABLE IF NOT EXISTS client_experience (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cared INTEGER NOT NULL,                  -- 1..5
  comment TEXT,
  by_id INTEGER REFERENCES users(id),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value store for app state (e.g., last weekly report sent).
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Surveys (client experience & meals) — templates, questions, responses, answers.
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS survey_questions (
  id INTEGER PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  category TEXT,
  text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'scale',   -- scale | rating | yesno | text
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  submitted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS survey_answers (
  id INTEGER PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  value_num INTEGER,
  value_text TEXT
);

-- Concierge / requests routed to departments (anticipate & fulfill every wish).
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  text TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',  -- Normal | High
  status TEXT NOT NULL DEFAULT 'Open',       -- Open | In progress | Done
  created_by INTEGER REFERENCES users(id),
  created_by_name TEXT,
  done_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);

-- Program / schedule: groups, activities, meals, outings, appointments.
CREATE TABLE IF NOT EXISTS schedule_items (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Group',        -- Group | Activity | Meal | Outing | Appointment | Wellness
  location TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,  -- null = facility-wide
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Treatment goals with progress.
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',      -- Active | Met
  target_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  met_at TEXT
);

-- Nursing: structured medications, the MAR, vitals, withdrawal scales.
CREATE TABLE IF NOT EXISTS meds (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, dose TEXT, route TEXT, schedule TEXT,
  prn INTEGER NOT NULL DEFAULT 0, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS med_admin (
  id INTEGER PRIMARY KEY,
  med_id INTEGER NOT NULL REFERENCES meds(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Given',  -- Given | Refused | Held
  note TEXT, given_by INTEGER REFERENCES users(id),
  given_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vitals (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bp TEXT, hr TEXT, temp TEXT, resp TEXT, o2 TEXT, weight TEXT, note TEXT,
  taken_by INTEGER REFERENCES users(id),
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawal_scores (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scale TEXT NOT NULL,     -- CIWA-Ar | COWS
  score INTEGER NOT NULL, note TEXT,
  taken_by INTEGER REFERENCES users(id),
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Family engagement: contacts, updates shared, visits.
CREATE TABLE IF NOT EXISTS family_contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, relationship TEXT, phone TEXT, email TEXT,
  can_update INTEGER NOT NULL DEFAULT 1, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS family_updates (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_name TEXT, text TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_name TEXT, date TEXT NOT NULL, time TEXT,
  type TEXT NOT NULL DEFAULT 'In-person',  -- In-person | Virtual | Family therapy
  status TEXT NOT NULL DEFAULT 'Scheduled', -- Scheduled | Completed | Cancelled
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admissions pipeline + bed board.
CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, referral_source TEXT, phone TEXT, insurance TEXT,
  status TEXT NOT NULL DEFAULT 'Inquiry', -- Inquiry | Screening | Scheduled | Admitted | Declined
  scheduled_date TEXT, notes TEXT, client_id INTEGER REFERENCES clients(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS beds (
  id INTEGER PRIMARY KEY,
  room TEXT NOT NULL, label TEXT, unit TEXT,
  status TEXT NOT NULL DEFAULT 'Open',   -- Open | Occupied | Hold | Cleaning
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL
);

-- Team: peer kudos + daily service-value training acknowledgement.
CREATE TABLE IF NOT EXISTS kudos (
  id INTEGER PRIMARY KEY,
  to_user_id INTEGER REFERENCES users(id), to_name TEXT,
  from_id INTEGER REFERENCES users(id), from_name TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS training_ack (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id), user_name TEXT,
  value_text TEXT, date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SOP / Policy library — the "how do we do this / what's the policy" station.
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'SOP', body TEXT NOT NULL,
  tags TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doc_reads (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(doc_id, user_id)
);

-- Training: courses, quiz questions, completions (proof of training).
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE, title TEXT NOT NULL, description TEXT, body TEXT,
  recert_days INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS course_questions (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  text TEXT NOT NULL, options TEXT NOT NULL, answer INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS course_completions (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id), user_name TEXT,
  score INTEGER, passed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily focus / refresher log (each day the team stresses one subject).
CREATE TABLE IF NOT EXISTS focus_logs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, topic TEXT,
  user_id INTEGER REFERENCES users(id), user_name TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documentation notes (from staff or ingested from the EMR/Kipu) — AI-scanned
-- for red flags (unhappy, bothered, AMA risk) that need follow-up.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL, author TEXT, source TEXT DEFAULT 'manual',
  flagged INTEGER NOT NULL DEFAULT 0, flag_level TEXT, flag_summary TEXT, categories TEXT, suggested_action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Assigned tasks — required, owned by a named teammate (incl. @mentions).
CREATE TABLE IF NOT EXISTS assigned_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, detail TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES users(id), assignee_name TEXT,
  assigned_by TEXT, source TEXT DEFAULT 'manual',
  due_date TEXT, status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT
);

-- The Save (PAUSE) tracker — de-escalation attempts and whether they stayed.
CREATE TABLE IF NOT EXISTS saves (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  trigger TEXT, note TEXT,
  outcome TEXT NOT NULL DEFAULT 'Pending',  -- Pending | Stayed | Left
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Lineup / huddle compliance log (the daily lineup happened this shift).
CREATE TABLE IF NOT EXISTS lineup_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, shift TEXT, by_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, shift)
);

-- Proactive alerts: surfaced the moment a client's signals turn.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,        -- risk | concern | request | incident | survey
  level TEXT,                -- High | Elevated | Critical | ...
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',  -- New | Ack
  ack_by INTEGER REFERENCES users(id), ack_name TEXT, ack_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alumni / continuing-care touchpoints (after a completed discharge).
CREATE TABLE IF NOT EXISTS alumni_notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Incident / safety reports (quality & compliance).
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                       -- Behavioral | Medical | Fall | Medication error | Property | Elopement/AMA | Other
  severity TEXT NOT NULL DEFAULT 'Low',     -- Low | Moderate | High | Critical
  description TEXT NOT NULL,
  action_taken TEXT,
  status TEXT NOT NULL DEFAULT 'Open',       -- Open | Reviewed | Closed
  reported_by INTEGER REFERENCES users(id), reported_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log: every access/modification of client data (HIPAA requirement)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  username TEXT,
  action TEXT NOT NULL,        -- VIEW | CREATE | UPDATE | DELETE | LOGIN | EXPORT ...
  entity TEXT,                 -- client | task | shift | ...
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Referral partners (facilities we send to and/or that send to us).
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,                   -- Detox | Residential | PHP | IOP | Outpatient | Sober Living | ...
  location TEXT,
  contact TEXT,
  notes TEXT,
  salesforce_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Outbound referrals: a client we discharge/step-down, OR a person we could not
-- accept and referred out (flagged by BD, Intake, or Clinical-on-arrival).
CREATE TABLE IF NOT EXISTS outbound_referrals (
  id INTEGER PRIMARY KEY,
  ref_date TEXT NOT NULL DEFAULT (date('now')),
  category TEXT NOT NULL,                 -- discharge | declined
  department TEXT NOT NULL,               -- Clinical | Business Development | Intake
  referred_by INTEGER REFERENCES users(id),
  referred_by_name TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  person_ref TEXT,                        -- initials/age for declined (minimal PII)
  facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  facility_name TEXT,
  loc_needed TEXT,
  reason TEXT,
  reason_detail TEXT,
  insurance TEXT,
  salesforce_id TEXT,
  synced_to_sf INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);

-- Inbound referrals (who sends us business) — powers partner reciprocity.
-- Usually synced from Salesforce; can also be logged by hand.
CREATE TABLE IF NOT EXISTS inbound_referrals (
  id INTEGER PRIMARY KEY,
  ref_date TEXT NOT NULL DEFAULT (date('now')),
  facility_id INTEGER REFERENCES facilities(id) ON DELETE SET NULL,
  facility_name TEXT,
  outcome TEXT,                           -- admitted | declined | pending
  salesforce_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scheduling: a staffing need (one row per part×role on a date, with how many needed).
CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  part TEXT NOT NULL,                      -- Morning | Day | Evening | Night
  role TEXT NOT NULL,                      -- BHT / Tech | Nurse | Therapist | Kitchen
  needed INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Who is assigned to a slot, and whether they called off.
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id INTEGER PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | called_off
  calloff_reason TEXT,
  calloff_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Time clock punches. source = app (in-app) | kipu | qbtime | adp | ... for later sync.
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  clock_in TEXT NOT NULL DEFAULT (datetime('now')),
  clock_out TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Safety rounds (from Kipu when charted there; manual fallback otherwise).
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  by_name TEXT,
  area TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  kipu_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Shift job-duty completions (simple log → completion % on the dashboard).
CREATE TABLE IF NOT EXISTS duty_logs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL DEFAULT (date('now')),
  part TEXT,
  role TEXT,
  text TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Seed SOP library + training courses + daily focus (idempotent) ----
export const FOCUS_TOPICS = [
  { t: 'Greet every client by their preferred name', g: 'Use each client\'s preferred name in your first sentence to them today.' },
  { t: 'Fix the fixable in under 5 minutes', g: 'When a client is frustrated, go to them within 5 minutes and solve the small thing (food, smoke break, comfort).' },
  { t: 'Deliver one unprompted delight', g: 'Do one small, personal thing for a client before they ask. Log it.' },
  { t: 'Run the Save — Pause before you react', g: 'In every hard moment, pause your own reaction first. Acknowledge before you solve.' },
  { t: 'Person-first language all shift', g: 'Describe behavior, never label character. "Returned to use," never "relapsed."' },
  { t: 'Close the loop out loud', g: 'Tell a client: "You said X — we did Y." Make being heard visible.' },
  { t: 'No one hungry', g: 'Offer seconds, check the snack station, ask about the food.' },
  { t: 'Recognize a teammate by name', g: 'Catch someone doing something great and say it specifically, today.' },
  { t: 'Ask the Listening question', g: 'Ask each client: "What\'s one thing that would make today better?" and write it down.' },
  { t: 'Sit at eye level', g: 'For every hard conversation, sit down and meet them at eye level.' },
  { t: 'A human goes to the patient', g: 'Never manage distress through a message — go in person, every time.' },
  { t: 'Hold the open door', g: 'Remind at least one client, warmly, that they\'re welcome here and welcome back.' },
];
export function todaysFocus() { return FOCUS_TOPICS[Math.floor(Date.now() / 864e5) % FOCUS_TOPICS.length]; }

function ensureDoc(category, title, body, tags) {
  if (db.prepare(`SELECT id FROM docs WHERE title = ?`).get(title)) return;
  db.prepare(`INSERT INTO docs (title, category, body, tags, updated_by) VALUES (?, ?, ?, ?, 'Armada Standard')`).run(title, category, body, tags || null);
}
function ensureCourse(key, title, description, body, recert, questions) {
  if (db.prepare(`SELECT id FROM courses WHERE key = ?`).get(key)) return;
  const info = db.prepare(`INSERT INTO courses (key, title, description, body, recert_days, sort) VALUES (?, ?, ?, ?, ?, ?)`).run(key, title, description, body, recert, 0);
  const ins = db.prepare(`INSERT INTO course_questions (course_id, text, options, answer, sort) VALUES (?, ?, ?, ?, ?)`);
  questions.forEach((q, i) => ins.run(info.lastInsertRowid, q.q, JSON.stringify(q.o), q.a, i));
}

function seedLearning() {
  ensureDoc('Policy', 'Crisis Escalation Ladder (L1–L4)',
    'The One Rule: a human goes to the patient, always — never a chat.\n\nL1 First signs (pacing, agitation): Crisis Owner goes within 5 minutes; sit, listen, fix the fixable. Most crises end here.\nL2 Escalating (shouting, demands): Crisis Owner + clinical staff respond together in person; on-call leader called; comfort per protocol; no ultimatums, no "calm down," no audience.\nL3 "I\'m leaving": leader + clinician engaged; run the Save; if staying, re-stabilize and follow up within an hour; if leaving, Safe Departure every step.\nL4 Safety event: 911/medical per clinical judgment; never block an exit, never restrain to retain; debrief within 24 hours.', 'crisis, escalation, owner');
  ensureDoc('SOP', 'Running the Daily Lineup',
    'Every shift, every day, including nights — led, 10–15 minutes:\n1. One principle of the Standard (rotating).\n2. Today\'s info: census, acuity, arrivals/departures, Crisis Owner named, on-call leader posted.\n3. Preference Board highlights — who needs what today.\n4. Recognition by name — specific, same-day.\n5. One defect from the Listening System and who owns the fix.', 'lineup, huddle');
  ensureDoc('SOP', 'Handoff Standard',
    'No shift hands the next a mess. Before change of shift: beds made, kitchen reset, smoke supplies prepped, snack station stocked, Preference Board updated, open issues briefed person-to-person. The handoff is a face-to-face ritual, not a note.', 'handoff, shift change');
  ensureDoc('SOP', 'Preference Board — how to use',
    'Every staff member is an antenna: notice a preference, write it down (initial + date), act on it. Capture preferred name & pronunciation, drinks, food loves/dislikes, comfort, sleep rhythm, what calms them, approach-with-care notes (written as if the client will read them), interests, important people, wins. Preferences only — no diagnoses, meds, or behavior reports. Update every shift. "Being known without having to ask is the product."', 'preferences, care card');
  ensureDoc('Policy', 'Smoking & Nicotine Schedule',
    'Smoking permitted in the designated area on a fixed published schedule (5–6 breaks at posted times). NRT offered to every smoker at intake per medical protocol. Smoke breaks are never a behavioral lever — never reward, never punishment, never canceled for the unit. Lighters staff-held. No personal vapes on the unit.', 'smoking, nicotine, nrt');
  ensureDoc('Policy', 'The Table — food service standard',
    'Food is comfort, dignity, and medicine. Seconds are the default — the answer is yes (only "no" is a documented clinical restriction). 24/7 snack access — nobody hungry at 2 a.m. Meal rhythm posted and reliable; special diets honored. Dining room calm during service.', 'food, meals, kitchen');
  ensureDoc('Policy', 'Empowerment — solve it on the spot',
    'Every staff member may spend up to the set limit ($50–100) to solve a patient problem on the spot — no permission needed, logged afterward (use the Concierge/Delight log). Fix the fixable: food, nicotine, comfort, fear, dignity.', 'empowerment, delight, $2000 rule');
  ensureDoc('SOP', 'The Intake Anchor & The Quiet AMA',
    'The polite "I\'m good, I\'ll do it on my own" departure is won or lost at admission — long before the client ever says they want to leave.\n\nTHE INTAKE ANCHOR (set it at admission, capture it on the Care Card):\n• Ask "What brought you here tonight?" and write down the WHY in the client\'s OWN words — verbatim. This becomes their ⚓ Intake Anchor on the Care Card and Journey.\n• Pre-brief THE WAVE: tell them plainly that motivation is highest at intake and often dips by morning — that the urge to leave is part of the process, not a sign they made the wrong choice. Naming it now defuses it later.\n• The clinician sets the timeline: "Give it 24–72 hours before you make any decision about leaving."\n\nTHE QUIET AMA (the calm, polite "I feel fine, I\'ll finish at home"):\n• This is the dangerous one — no crisis, no shouting, easy to wave through. Treat "I feel fine" as the cue to engage, not to process paperwork.\n• READ THEIR OWN WORDS BACK to them — the Anchor: "When you got here you told me ___. Has that changed?" Their own why is the strongest argument.\n• Make the 48-HOUR ASK — time-boxed, concrete: "Give me 48 more hours. If you still want to go then, I\'ll help you leave safely." A small, finite ask beats arguing about treatment.\n• If they still leave, Safe Departure (Warm AMA) every step.\n\nTHE SECOND SAVE: the 24–48 hour follow-up call after a Quiet AMA is a real Save attempt, not a courtesy. Many will come back if the door is warm. Make the call, document it, and offer the bed back.', 'intake, anchor, ama, quiet ama, wave, retention');

  ensureCourse('save', 'The Save (PAUSE) — de-escalation & AMA prevention',
    'The core skill for keeping clients. Certify before solo floor work.',
    'More than half of opioid-detox patients can leave AMA without intervention. The Save is the counter-skill.\n\nP — Pause your own reaction.\nA — Acknowledge the feeling ("This is miserable, and you\'re not wrong to be frustrated").\nU — Understand what\'s underneath (fear, withdrawal, nicotine, family, court, shame).\nS — Solve the fixable (food, smoke-break clarity, comfort per protocol, a phone call, a blanket).\nE — Extend the door to stay — always an invitation, never an ultimatum.\n\nConfrontation backfires; motivational-interviewing style works. Document a successful save and thank the team at lineup.', 180,
    [
      { q: 'What does the P in PAUSE stand for?', o: ['Pause your own reaction', 'Page the on-call leader', 'Print the discharge form'], a: 0 },
      { q: 'When you Extend the door to stay, it should be:', o: ['An ultimatum', 'An invitation, never an ultimatum', 'A warning about consequences'], a: 1 },
      { q: 'Which is the right move when a client is escalating?', o: ['Tell them to calm down in front of others', 'Acknowledge the feeling and solve the fixable', 'Threaten loss of privileges'], a: 1 },
    ]);
  ensureCourse('safe-departure', 'Safe Departure (Warm AMA)',
    'Every departure, including AMA, follows these steps.',
    'Applies to every departure, especially AMA:\n1. In-person, calm conversation; AMA explained in plain language with risks and the open door.\n2. Refusal to sign is witnessed by two staff and documented — refusal to sign is still an AMA.\n3. Naloxone goes with them, every time, plus 60-second overdose education (per clinical protocol — Medical Director owns).\n4. Belongings returned with dignity; destination/transport asked; food for the road offered.\n5. Last words are an invitation: "You are welcome back — any time."\n6. Follow-up call within 24–72 hours, documented; charted same shift, classified correctly.', 180,
    [
      { q: 'A client refuses to sign the AMA form. The departure is:', o: ['Not an AMA', 'Still an AMA — document witnessed refusal', 'An administrative discharge'], a: 1 },
      { q: 'What goes with the client at every departure?', o: ['Nothing', 'Naloxone + overdose education (per protocol)', 'A bill'], a: 1 },
      { q: 'The last words to a departing client should be:', o: ['"Don\'t come back"', '"You are welcome back any time"', 'Nothing'], a: 1 },
    ]);
  ensureCourse('intake-anchor', 'The Intake Anchor & The Quiet AMA',
    'How to win the polite AMA at admission — and what to do when "I feel fine, I\'ll finish at home" arrives.',
    'The quiet, polite departure is won at admission.\n\nSET THE ANCHOR AT INTAKE:\n• Ask "What brought you here tonight?" — capture the WHY in their own words on the Care Card (their ⚓ Intake Anchor).\n• Pre-brief THE WAVE: motivation is highest now and usually dips by morning; the urge to leave is part of detox, not proof they chose wrong.\n• Clinician sets the timeline: "Give it 24–72 hours before deciding anything."\n\nWHEN THE QUIET AMA COMES:\n• "I feel fine, I\'ll do the rest at home" is the cue to ENGAGE — not to hand over paperwork.\n• Read their own Anchor words back: "When you got here you told me ___ — has that changed?"\n• Make the 48-HOUR ASK: a small, time-boxed, concrete request beats arguing.\n• Still leaving? Safe Departure every step, then a follow-up call in 24–48h — the second Save.', 180,
    [
      { q: 'The Intake Anchor is:', o: ['The client\'s diagnosis', 'Why they came, in their own words, captured at admission', 'Their discharge date'], a: 1 },
      { q: '"The wave" you pre-brief at intake is:', o: ['A visiting-hours policy', 'That motivation dips by morning and the urge to leave is part of the process', 'A type of group therapy'], a: 1 },
      { q: 'A client calmly says "I feel fine, I\'ll finish at home." The best first move is:', o: ['Hand them the AMA form', 'Read their own Anchor words back and make the 48-hour ask', 'Tell them they\'ll relapse'], a: 1 },
      { q: 'After a quiet AMA, the 24–48 hour follow-up call is:', o: ['A courtesy with no real purpose', 'A real second Save attempt — make it, document it, offer the bed back', 'Optional and usually skipped'], a: 1 },
    ]);
  ensureCourse('person-first', 'Person-First Language',
    'How we speak about the people we serve — always.',
    'Person-first, always:\n• "Person with a substance use disorder" — never "addict/junkie/user."\n• "Returned to use" — never "dirty/relapsed."\n• "Negative/positive result" — never "clean/dirty."\n• "Chose to leave against medical advice" — never "eloped/bolted/absconded."\n• Describe behavior ("pacing, raised voice") — never label character ("difficult," "manipulative," "drug-seeking").\n• No lay diagnosis — only clinicians name conditions.', 365,
    [
      { q: 'Which phrase is person-first?', o: ['"The addict in room 6"', '"Person with a substance use disorder"', '"Junkie"'], a: 1 },
      { q: 'Instead of "he relapsed," say:', o: ['"He returned to use"', '"He went back to his old ways"', '"He got dirty"'], a: 0 },
      { q: 'A non-clinician should:', o: ['Diagnose "he\'s manic"', 'Describe behavior, not label character', 'Call the client "manipulative" in the chart'], a: 1 },
    ]);
}
seedLearning();

// Lightweight migration: add columns to existing tables (older deployments).
function addColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
addColumn('ama_reads', 'underlying', 'TEXT');
addColumn('ama_reads', 'cared_for', 'TEXT');
addColumn('ama_reads', 'best_play', 'TEXT');
addColumn('clients', 'welcome_plan', 'TEXT');
addColumn('clients', 'aftercare_plan', 'TEXT');
addColumn('clients', 'discharge_status', 'TEXT');
addColumn('clients', 'discharge_date', 'TEXT');
addColumn('clients', 'allergies', 'TEXT');
addColumn('clients', 'medications', 'TEXT');
addColumn('shifts', 'crisis_owner_id', 'INTEGER');
addColumn('shifts', 'crisis_owner_name', 'TEXT');
addColumn('clients', 'departure_steps', 'TEXT');
addColumn('clients', 'discharge_reason', 'TEXT');
addColumn('clients', 'discharge_followthrough', 'TEXT');
addColumn('clients', 'discharge_improve', 'TEXT');
addColumn('followups', 'assignee_id', 'INTEGER');
addColumn('followups', 'assignee_name', 'TEXT');
addColumn('users', 'mfa_secret', 'TEXT');
addColumn('users', 'mfa_enabled', 'INTEGER');
addColumn('clients', 'consent_on_file', 'INTEGER');
addColumn('clients', 'anchor_why', 'TEXT');
// Analytics dimensions: time-of-admit + staff attribution + discharge destination.
addColumn('clients', 'admit_time', 'TEXT');            // HH:MM (24h) — for time-of-admit analysis
addColumn('clients', 'therapist', 'TEXT');             // primary therapist (for outcome attribution)
addColumn('clients', 'case_manager', 'TEXT');          // case manager
addColumn('clients', 'discharge_destination', 'TEXT'); // where they went (facility/home/etc.)
addColumn('clients', 'kipu_id', 'TEXT');               // external EMR id (idempotent Kipu sync)
addColumn('clients', 'source', 'TEXT');                // kipu | warehouse | manual (null = manual)

// ---- Outbound-referral vocabulary (shared with the front-end via /api/meta) ----
export const REFERRAL_DEPARTMENTS = ['Clinical', 'Business Development', 'Intake'];
export const REFERRAL_CATEGORIES = [
  { key: 'discharge', label: 'Discharge / step-down (completed or progressing)' },
  { key: 'transfer', label: 'Mid-treatment transfer (admitted client → another facility)' },
  { key: 'declined', label: 'Declined / could not accept (referred out)' },
];
export const REFERRAL_REASONS = [
  'Wrong level of care for us (needs higher LOC)',
  'Wrong level of care for us (needs lower LOC / step-down)',
  'Needs detox / medical stabilization first',
  'Behavioral issues / not appropriate for the milieu',
  'Client / family wants a different facility',
  "Specialized care we don't offer (ED, primary MH, etc.)",
  'Insurance / out-of-network / financial',
  'No bed / capacity',
  'Geographic / closer to home',
  'Completed program — aftercare placement',
  'Left AMA — referred to alternative',
  'Other',
];
export const FACILITY_TYPES = [
  'Detox', 'Residential / RTC', 'PHP', 'IOP', 'Outpatient', 'Sober Living',
  'Mental Health', 'Hospital / Medical', 'Dual Diagnosis', 'Other',
];
export const DISCHARGE_TYPES = ['Completed', 'AMA', 'Transferred', 'Administrative', 'Detox complete', 'Other'];

// Seed the default surveys (idempotent — only inserts questions on first creation).
function ensureSurvey(key, title, description, sort, questions) {
  let s = db.prepare(`SELECT id FROM surveys WHERE key = ?`).get(key);
  if (s) return;
  const info = db.prepare(`INSERT INTO surveys (key, title, description, sort) VALUES (?, ?, ?, ?)`).run(key, title, description, sort);
  const sid = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO survey_questions (survey_id, category, text, type, sort) VALUES (?, ?, ?, ?, ?)`);
  questions.forEach((q, i) => ins.run(sid, q[0], q[1], q[2] || 'scale', i));
}

ensureSurvey('experience', 'Client Experience Survey',
  'How cared for do you feel? Modeled on the Ritz-Carlton guest experience.', 1, [
  ['Care & dignity', 'I feel genuinely cared for here.', 'scale'],
  ['Care & dignity', 'Staff treat me with dignity and respect.', 'scale'],
  ['Care & dignity', 'Staff know me by name and remember what matters to me.', 'scale'],
  ['Care & dignity', 'Staff anticipate my needs before I have to ask.', 'scale'],
  ['Staff & responsiveness', 'When I need help, staff respond quickly.', 'scale'],
  ['Staff & responsiveness', 'Staff are warm and approachable.', 'scale'],
  ['Staff & responsiveness', 'I know who to go to if I have a problem.', 'scale'],
  ['Program & care', 'The groups and therapy are helpful to me.', 'scale'],
  ['Program & care', 'My treatment goals are understood.', 'scale'],
  ['Program & care', 'I feel hopeful about my recovery.', 'scale'],
  ['Program & care', 'I feel safe here.', 'scale'],
  ['Environment', 'My room is comfortable.', 'scale'],
  ['Environment', 'The facility is clean and well kept.', 'scale'],
  ['Environment', 'The environment feels calm and healing.', 'scale'],
  ['Environment', 'I am able to sleep well.', 'scale'],
  ['Belonging', 'I feel like I belong here.', 'scale'],
  ['Belonging', 'Someone here has made me feel truly seen.', 'scale'],
  ['Problem resolution', 'Have you raised a concern during your stay?', 'yesno'],
  ['Problem resolution', 'If yes, was it resolved to your satisfaction?', 'yesno'],
  ['Overall', 'Overall, how would you rate your experience?', 'rating'],
  ['Overall', 'How likely are you to recommend Armada to someone who needs help?', 'scale'],
  ['Overall', 'What is one thing we could do to make you feel more cared for?', 'text'],
  ['Overall', 'Is there a staff member you would like to recognize?', 'text'],
]);

ensureSurvey('meals', 'Meal & Food Survey',
  'Tell us about the food and dining experience.', 2, [
  ['Quality', 'Overall, how satisfied are you with the food?', 'rating'],
  ['Quality', 'The food tastes good and is well prepared.', 'scale'],
  ['Quality', 'Meals are served warm/fresh and at good times.', 'scale'],
  ['Variety', 'There is enough variety in the meals.', 'scale'],
  ['Variety', 'Portion sizes are right for me.', 'scale'],
  ['Dietary', 'My dietary needs and restrictions are respected.', 'scale'],
  ['Dietary', 'Special requests are honored when possible.', 'scale'],
  ['Environment', 'The dining area is clean and pleasant.', 'scale'],
  ['Open', 'Is there a food or drink you wish we offered?', 'text'],
  ['Open', 'Anything about meals we could do better?', 'text'],
]);

ensureSurvey('discharge', 'Discharge Experience Survey',
  'A few questions as you complete your stay.', 3, [
  ['Overall', 'Overall, how would you rate your time with us?', 'rating'],
  ['Overall', 'I feel more hopeful and prepared than when I arrived.', 'scale'],
  ['Overall', 'I felt genuinely cared for throughout my stay.', 'scale'],
  ['Aftercare', 'I understand my aftercare plan and next steps.', 'scale'],
  ['Aftercare', 'I know how to reach someone if I need support.', 'scale'],
  ['Loyalty', 'How likely are you to recommend Armada to someone who needs help?', 'scale'],
  ['Open', 'What moment or person made the biggest difference for you?', 'text'],
  ['Open', 'What could we have done better?', 'text'],
]);

export function getState(key) {
  return db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key)?.value ?? null;
}
export function setState(key, value) {
  db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function audit({ user, action, entity = null, entity_id = null, detail = null, ip = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(user?.id ?? null, user?.username ?? null, action, entity, entity_id, detail, ip);
}

export default db;

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

-- Activity / amenity engagement: which clients are actually using the music
-- room, gym, art room, arcade, etc. Boredom is a top AMA driver, so we track
-- utilization and surface who is disengaged.
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  note TEXT,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_client ON activities(client_id, created_at);

-- Shift care check-in: a rotating Horst question asked of each client every
-- shift on rounds ("hungry? bored? what would make your stay better?"), so the
-- guest's voice is gathered and unmet needs get acted on.
CREATE TABLE IF NOT EXISTS client_checkins (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  question TEXT, answer TEXT, shift TEXT,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkins ON client_checkins(client_id, created_at);

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
-- Manual recognition-raffle entries (for staff not yet in the app — added from
-- email replies). Each row carries a ticket count for the weekly drawing.
CREATE TABLE IF NOT EXISTS raffle_entries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Bed turnover board (RT bed flips): a bed flags 'dirty' when a client discharges
-- (auto, via Kipu sync) or by hand for a room switch; RTs mark it clean/open.
CREATE TABLE IF NOT EXISTS bed_turnovers (
  id INTEGER PRIMARY KEY,
  room TEXT NOT NULL,
  who TEXT,                                  -- first name of who vacated (staff-facing)
  reason TEXT,                               -- discharge | transfer | manual
  status TEXT NOT NULL DEFAULT 'dirty',      -- dirty | clean
  flagged_at TEXT NOT NULL DEFAULT (datetime('now')),
  flagged_shift TEXT,
  cleaned_by TEXT,
  cleaned_at TEXT,
  cleaned_shift TEXT
);
-- Staff Voice: employees say what would make this a better place to work
-- (anonymous-friendly); leadership responds and closes the loop, visible to all.
CREATE TABLE IF NOT EXISTS staff_voice (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',       -- open | done
  response TEXT,
  responded_by TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Growth check-ins: per-teammate development goals + 1:1 notes, so people see a future here.
CREATE TABLE IF NOT EXISTS growth_checkins (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER REFERENCES users(id),
  staff_name TEXT NOT NULL,
  goal TEXT,
  note TEXT,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Extra Mile wall: how teammates lived the day's value / went above and beyond.
-- A team-wide morale feed (everyone sees it), fed from daily-lineup replies.
CREATE TABLE IF NOT EXISTS extra_mile (
  id INTEGER PRIMARY KEY,
  person TEXT NOT NULL,                     -- who went the extra mile
  story TEXT NOT NULL,                      -- what they did (no client-identifying details)
  value_text TEXT,                          -- the day's service value, when known
  by_name TEXT,                             -- who reported it (self or a teammate)
  source TEXT DEFAULT 'lineup',             -- lineup | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 90-Day Belonging & Service Excellence plan: per-task completion tracking. The
-- task list itself lives in code (the curriculum); this just records what's done.
CREATE TABLE IF NOT EXISTS plan_progress (
  task_id TEXT PRIMARY KEY,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  done_by TEXT,
  note TEXT
);
-- Belonging pulse (the plan's leading indicator): 3 anonymous 1-5 ratings —
-- "I feel part of something here / My input is heard / I'm treated with respect."
CREATE TABLE IF NOT EXISTS belonging_pulses (
  id INTEGER PRIMARY KEY,
  q1 INTEGER, q2 INTEGER, q3 INTEGER,        -- 1-5 each
  note TEXT,
  weekend INTEGER NOT NULL DEFAULT 0,        -- submitted on a weekend (weekend-staff signal)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- AMA defect log (Schulze "a complaint is a gift"): every AMA / near-AMA tagged
-- with a root cause so patterns (esp. nights/weekends) point at fixable gaps.
CREATE TABLE IF NOT EXISTS ama_defects (
  id INTEGER PRIMARY KEY,
  client_id INTEGER,
  client_name TEXT,
  kind TEXT NOT NULL DEFAULT 'ama',          -- ama | near_miss
  root_cause TEXT,
  weekend INTEGER NOT NULL DEFAULT 0,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Comfort-med response timer (Schulze "timely"): requested → given, so
-- time-to-comfort is measurable. A 40-min wait at hour 18 is when people leave.
CREATE TABLE IF NOT EXISTS comfort_meds (
  id INTEGER PRIMARY KEY,
  client_id INTEGER, client_name TEXT,
  note TEXT,
  requested_by TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  given_by TEXT,
  given_at TEXT
);
-- Sacred onboarding (Day 1 immersion / Day 21 reorientation). Per-hire records;
-- the task curriculum lives in code, completion here.
CREATE TABLE IF NOT EXISTS onboardings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, role TEXT, start_date TEXT NOT NULL,
  by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS onboarding_progress (
  onboarding_id INTEGER, task_id TEXT,
  done INTEGER NOT NULL DEFAULT 1, done_at TEXT, done_by TEXT,
  PRIMARY KEY (onboarding_id, task_id)
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
-- Replies/follow-up on an assigned task — a thread between assigner and assignee.
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES assigned_tasks(id) ON DELETE CASCADE,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_comments ON task_comments(task_id);

-- 1:1 / group sessions with homework — the clinical "make time + give material"
-- loop. Each session records the topic, a note, and material assigned to complete
-- before the next session; clients overdue for a 1:1 surface on the dashboard.
CREATE TABLE IF NOT EXISTS client_sessions (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '1:1',          -- 1:1 | Group
  topic TEXT, note TEXT,
  homework TEXT,                             -- material to complete before next session
  homework_done INTEGER NOT NULL DEFAULT 0, homework_done_at TEXT,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_sessions ON client_sessions(client_id, created_at);

-- STAFFING MODEL — the facility's staffing standard (how many of each role per
-- shift) and a daily log of actual coverage, so every shift can be checked for
-- full staffing and AMA can be trended against staffing patterns.
CREATE TABLE IF NOT EXISTS staffing_standard (
  id INTEGER PRIMARY KEY,
  block TEXT NOT NULL,                       -- Nursing — Day | Nursing — Night | RT | Case Mgmt / Therapist | Support
  role TEXT NOT NULL,
  shift_label TEXT NOT NULL,                 -- e.g. 7a–7p, 7a–3p, 8a–4p
  needed INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(role, shift_label)
);
CREATE TABLE IF NOT EXISTS shift_staffing (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                        -- YYYY-MM-DD
  role TEXT NOT NULL,
  shift_label TEXT NOT NULL,
  needed INTEGER NOT NULL DEFAULT 0,
  actual INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, role, shift_label)
);
CREATE INDEX IF NOT EXISTS idx_shift_staffing ON shift_staffing(date);

-- ARRIVAL CHECKLISTS — each role's "on arrival" tasks for a new admit (the warm
-- welcome, done right). arrival_items is the editable template per role;
-- arrival_checks records completion per admit (a row = done).
CREATE TABLE IF NOT EXISTS arrival_items (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,                        -- RT / BHT | Nurse | Case Mgmt / Therapist | Front Desk
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS arrival_checks (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES arrival_items(id) ON DELETE CASCADE,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_arrival_checks ON arrival_checks(client_id);

-- STAFF MESSAGING — a shared Team channel + 1:1 direct messages between staff.
-- channel = 'team' for everyone, or 'dm:<lowId>-<highId>' for a direct thread.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, id);
CREATE TABLE IF NOT EXISTS message_reads (
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, channel)
);

-- OPERATIONS SYSTEMS (Director of Operations scorecard) ----------------------
-- Per-shift environment walk (beds/rooms/common/kitchen pass + defects).
CREATE TABLE IF NOT EXISTS environment_checks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, shift TEXT NOT NULL,
  beds INTEGER NOT NULL DEFAULT 0, rooms INTEGER NOT NULL DEFAULT 0,
  common INTEGER NOT NULL DEFAULT 0, kitchen INTEGER NOT NULL DEFAULT 0,
  defects TEXT, by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, shift)
);
-- Per-shift operational handoff (stock/beds/kitchen/smokes prepped for next shift).
CREATE TABLE IF NOT EXISTS ops_handoffs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, shift TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0, beds INTEGER NOT NULL DEFAULT 0,
  kitchen INTEGER NOT NULL DEFAULT 0, smokes INTEGER NOT NULL DEFAULT 0,
  note TEXT, by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, shift)
);
-- A logged "CEO had to fix/source something operational" — the rescue count is
-- the metric (zero = the systems held).
CREATE TABLE IF NOT EXISTS ceo_rescues (
  id INTEGER PRIMARY KEY,
  what TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Project tracker: buildouts/initiatives with owner, date, status, checklist.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, owner TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Planned',     -- Planned | In progress | Blocked | Done
  checklist TEXT, notes TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Recurring operational routines (the DOO's daily/weekly/monthly task manager).
-- A template + a per-date completion log, so "what do I do today" is never a guess.
CREATE TABLE IF NOT EXISTS ops_routines (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'daily',      -- daily | weekly | monthly
  dow INTEGER,                                -- weekly: 0=Sun..6=Sat
  dom INTEGER,                                -- monthly: 1..28
  link TEXT,                                  -- view to open (inventory, meals, etc.)
  role TEXT NOT NULL DEFAULT 'Director of Operations',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ops_routine_log (
  id INTEGER PRIMARY KEY,
  routine_id INTEGER NOT NULL REFERENCES ops_routines(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(routine_id, date)
);
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

-- Expected arrivals (front-desk board): who's scheduled to admit, pulled from
-- Salesforce Leads (Date_Looking_to_Admit__c). Front desk greets them, marks
-- arrived/no-show; a Kipu admission flips them to arrived automatically.
CREATE TABLE IF NOT EXISTS expected_arrivals (
  id INTEGER PRIMARY KEY,
  sf_lead_id TEXT UNIQUE,
  first_name TEXT, last_name TEXT, preferred_name TEXT,
  dob TEXT, phone TEXT,
  scheduled_date TEXT,                    -- YYYY-MM-DD they're expected
  program TEXT, referral_source TEXT, insurance TEXT,
  status TEXT NOT NULL DEFAULT 'expected', -- expected | arrived | no_show | cancelled
  arrived_at TEXT,                        -- when marked/auto-arrived
  auto INTEGER NOT NULL DEFAULT 0,        -- 1 = arrival confirmed by Kipu admission
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  follow_up TEXT,                         -- no-show follow-up note
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_arrivals_date ON expected_arrivals(scheduled_date);

-- SUPPLY STANDARDS (Horst "anticipate every need — never run out") -------------
-- The catalog of everything we keep on hand, owned by a department. Each item has
-- a par level (target on-hand) and a reorder point (count at/below = "low" → fires
-- a reorder request + email to corporate). Critical items (Narcan, AED, first aid)
-- are flagged so an Out is escalated. Expiry-tracked items prompt a date.
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,                -- Kitchen | Housekeeping | Front Desk | Medical | Safety
  category TEXT,                           -- grouping within a department
  unit TEXT NOT NULL DEFAULT 'each',       -- box, case, pack, roll, each…
  par_level INTEGER NOT NULL DEFAULT 0,    -- target quantity on hand
  reorder_point INTEGER NOT NULL DEFAULT 0,-- at/below this = low → reorder
  critical INTEGER NOT NULL DEFAULT 0,     -- never-out item (escalates on Out)
  track_expiry INTEGER NOT NULL DEFAULT 0, -- prompt for an expiry date on count
  shift_check INTEGER NOT NULL DEFAULT 1,  -- part of the every-shift checklist
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_items_dept ON inventory_items(department, active);

-- One shift count of one item: qty on hand + computed status. The checklist log.
CREATE TABLE IF NOT EXISTS inventory_counts (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                     -- ok | low | out
  shift TEXT,                              -- Morning | Day | Evening | Night
  expiry TEXT,                             -- earliest expiry seen (track_expiry items)
  note TEXT,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_counts_item ON inventory_counts(item_id, created_at);

-- A reorder request — raised when an item hits low/out, emailed to corporate.
CREATE TABLE IF NOT EXISTS reorder_requests (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL,                      -- low | out
  status TEXT NOT NULL DEFAULT 'open',      -- open | ordered | received
  requested_by_id INTEGER REFERENCES users(id),
  requested_by TEXT,
  note TEXT,
  emailed_at TEXT,
  ordered_at TEXT, ordered_by TEXT,
  received_at TEXT, received_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reorder_status ON reorder_requests(status, item_id);

-- MAINTENANCE / WORK ORDERS — staff report a fix, it routes to the right owner,
-- and nothing falls through the cracks. Open items show on a shared board; aging
-- High/Urgent items escalate so they're never silently ignored.
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  location TEXT,                            -- room / area
  category TEXT NOT NULL DEFAULT 'General', -- Plumbing | Electrical | HVAC | Appliance | Furniture | Safety/Security | IT/Tech | Cleaning/Biohazard | General
  priority TEXT NOT NULL DEFAULT 'Normal',  -- Low | Normal | High | Urgent
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',       -- open | in_progress | resolved | closed
  reported_by_id INTEGER REFERENCES users(id),
  reported_by TEXT,
  assigned_to TEXT,                         -- person/vendor working it
  resolution TEXT,                          -- what was done
  emailed_at TEXT,
  resolved_at TEXT, resolved_by TEXT,
  escalated_at TEXT,                        -- last aging-escalation (dedupe)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_requests(status, priority);

-- MEAL SERVICE — the Ritz receiving inspection. Every meal the caterer delivers
-- is checked by the tech serving it: enough portions vs. census, all food groups
-- present (protein/carb/veg/fruit…), and whether clients liked it. One row per
-- meal per day (upsert). Feeds a caterer scorecard so standards stay tight.
CREATE TABLE IF NOT EXISTS meal_checks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  meal TEXT NOT NULL,                       -- Breakfast | Lunch | Dinner | Snack
  expected INTEGER,                         -- portions we needed (census + welcome)
  received INTEGER,                         -- portions actually delivered
  groups TEXT,                              -- JSON array of food groups present
  liked TEXT,                               -- Liked | OK | Disliked
  quality INTEGER,                          -- 1–5 (optional)
  issues TEXT,                              -- what was wrong / missing
  photo TEXT,                               -- optional delivery photo (data URL)
  complete INTEGER NOT NULL DEFAULT 0,      -- 1 = met portions + all required groups
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, meal)
);
-- MEAL FEEDBACK — the resident's own voice on each meal, captured from the dining-room
-- kiosk. Three taps (enjoyed / enough / want again) + an optional word, stamped with
-- the local meal date + which meal, so leadership can read how every breakfast, lunch,
-- and dinner actually landed, day by day. Anonymous-friendly: client_id is optional.
CREATE TABLE IF NOT EXISTS meal_feedback (
  id INTEGER PRIMARY KEY,
  meal_date TEXT NOT NULL,                  -- YYYY-MM-DD (local dining-room date)
  meal TEXT NOT NULL,                       -- Breakfast | Lunch | Dinner
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  liked INTEGER,                            -- 1 enjoyed | 0 didn't
  enough INTEGER,                           -- 1 enough | 0 still hungry
  again INTEGER,                            -- 1 would want again | 0 not really
  comment TEXT,                             -- optional one line, in their words
  dish TEXT,                                -- snapshot of what was served (from the menu)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meal_feedback_day ON meal_feedback(meal_date, meal);
-- MEAL MENU — what's actually being served each meal, set by staff (residents don't
-- enter this). Gives the pulse meaning ("want THIS again") and tells the kiosk what
-- to show. One row per meal per day (upsert).
CREATE TABLE IF NOT EXISTS meal_menu (
  id INTEGER PRIMARY KEY,
  menu_date TEXT NOT NULL,                  -- YYYY-MM-DD
  meal TEXT NOT NULL,                       -- Breakfast | Lunch | Dinner
  dish TEXT,                                -- what's being served (free text)
  notes TEXT,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(menu_date, meal)
);
CREATE INDEX IF NOT EXISTS idx_meal_checks ON meal_checks(date, meal);

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
-- Reusable shift rows for the weekly grid editor (role mapped to a standard role,
-- plus a free-text label that keeps the real detail e.g. "Intake · 7:00 AM").
CREATE TABLE IF NOT EXISTS shift_templates (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  shift_label TEXT NOT NULL,
  part TEXT NOT NULL DEFAULT 'Day',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
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
-- Manually-added on-shift staff (for people who don't have a user login yet).
-- Counted as "on shift now" for the day they were added; cleared automatically.
CREATE TABLE IF NOT EXISTS manual_on_shift (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  by_name TEXT,
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
  ensureDoc('Policy', 'Safety Rounds — Scan Verification & Accountability',
    'Why: a round is a face-to-face safety check, not a signature on a sheet. To prove every round actually happened, a QR code is mounted at the FARTHEST reachable point of every room and common area (dining, lounge, group rooms, activity room, entrances). You only get credit for a round when you physically walk to that point and scan it with your iPad/phone.\n\nHow:\n1. Every check-in cycle, do a FULL sweep — scan every active point. A room scan also logs the safety check for the client(s) in that room.\n2. Scan using the in-app live scanner (Scan Rounds → Scan a point). It must be scanned live — photographing a QR and scanning the picture will not log, and rapid "impossible" scan bursts are flagged for review. If a QR is damaged, type the code printed beneath it and tell maintenance.\n3. The Scan Rounds board shows what\'s covered and what\'s overdue (red) this cycle — clear the reds.\n\nAccountability (progressive, never automatic):\n- The system rates each employee by scans completed and on-time compliance.\n- Missed scans are coached first. Pattern of misses → documented verbal coaching → written warning → final warning → termination. Every step is reviewed by a leader with context (call-offs, emergencies, census). Termination is a human decision, documented — never triggered by the software alone.\n- Falsifying a round (scanning without checking, or having someone else scan for you) is a serious integrity violation and is grounds for immediate disciplinary review.\n\nThe standard: we round to keep people safe and seen, not to satisfy a form. Walk the full space, lay eyes on every client, scan to prove it.', 'rounds, safety, scan, accountability, policy');
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

// ---- The Akron Standard: the 32-document operating system, loaded as an
// organized, read-ordered index in the Library. Each entry carries its
// section, read number, type, and source file; the body holds the summary now
// and is where the full document text gets pasted. Titles/categories are
// number-prefixed so they sort in the intended reading order. ----
function seedAkronStandard() {
  const SECTIONS = [
    '1 · Foundation & Culture',
    '2 · The Patient Journey',
    '3 · The People System',
    '4 · Structure & Operations',
    '5 · Safeguards & Measurement',
    '6 · Operating Documents',
  ];
  // [readNo, sectionIndex, title, fileName, type, whatItIs]
  const DOCS = [
    [1, 0, 'The Akron Standard — Operating Doctrine', 'Akron_Standard_Operating_Doctrine.docx', 'Doctrine', 'The master document: purpose, creed, the three moments of care, the non-negotiables, and the language dictionary.'],
    [2, 0, 'Ritz & Horst Principles Crosswalk', 'Akron_Ritz_Horst_Principles_Crosswalk.xlsx', 'Reference', 'Every Ritz/Horst principle mapped to how it applies to Armada and where it lives in the system.'],
    [3, 0, 'The Non-Negotiables Card', 'Akron_NonNegotiables_Card.pdf', 'Card', 'The double-sided badge card of the core standards staff carry.'],
    [4, 0, 'The Founding Deck', 'Akron_Standard_Founding_Deck.pptx', 'Deck', 'The all-staff slide deck that launches the Standard.'],
    [5, 0, 'Every Task Has a Purpose', 'Akron_Every_Task_Has_A_Purpose.docx', 'Manual', "Each role's tasks mapped to their purpose — function to intent."],
    [6, 1, 'The Continuum', 'Akron_The_Continuum.docx', 'Standard', 'The relationship before, around, and after the stay: front door, family, alumni/aftercare.'],
    [7, 1, 'The Intake Comfort SOP', 'Akron_Intake_SOP.pdf', 'SOP', 'Comfort within 15 minutes of arrival.'],
    [8, 1, 'The Patient Day', 'Akron_The_Patient_Day.docx', 'Standard', 'Excellence in the middle of the stay: daily rhythm, the milieu, managing the social field.'],
    [9, 1, 'The Environment Standard', 'Akron_The_Environment_Standard.docx', 'Standard', 'The physical stage: the senses, space by space, cleanliness, and safety.'],
    [10, 1, 'The Save — Training', 'Akron_The_Save_Training.docx', 'Training', 'Facilitator guide + manual for the AMA-Save (the PAUSE model).'],
    [11, 1, 'The Save — Deck', 'Akron_The_Save_Deck.pptx', 'Deck', 'The delivery deck for The Save training.'],
    [12, 1, 'The Send-Off — Discharge SOP', 'Akron_The_SendOff_Discharge_SOP.docx', 'SOP', 'The universal discharge standard, warm handoff, and follow-up calls.'],
    [13, 1, 'The Nourishment System', 'Akron_The_Nourishment_System.docx', 'System', 'Food: spend, measure, and decide — with the decision engine and surveys.'],
    [14, 2, 'The Selection System', 'Akron_The_Selection_System.docx', 'System', "Select, don't hire: the five core traits and the selection philosophy."],
    [15, 2, 'The Hiring Process', 'Akron_The_Hiring_Process.docx', 'Process', 'The candidate journey: assessments, who they meet, what we ask.'],
    [16, 2, 'The Hiring Scorecard', 'Akron_Hiring_Scorecard.pdf', 'Tool', 'The behavioral interview scoring instrument.'],
    [17, 2, 'Onboarding & Orientation', 'Akron_Onboarding_And_Orientation.docx', 'Program', 'The first 90 days; orientation as a significant emotional event.'],
    [18, 2, 'Training & Certification Program', 'Akron_Training_And_Certification_Program.docx', 'Program', 'The gated curriculum, competency sign-offs, and the certification gate — no solo floor work until certified.'],
    [19, 2, 'Training Record (& roster)', 'Akron_Training_Record.xlsx', 'Tool', 'The per-employee competency checklist and certification roster — the documented-competency record.'],
    [20, 2, 'The Certification Certificate', 'Akron_Certification_Certificate.docx', 'Certificate', 'The printable certificate issued at certification.'],
    [21, 2, 'Leading the Team', 'Akron_Leading_The_Team.docx', 'Playbook', 'Recognition, coaching, accountability, and the empowerment policy.'],
    [22, 2, 'The Armada Fleet — Uniform Standard', 'Akron_Armada_Fleet_Uniform_Standard.docx', 'Standard', 'The role-by-role uniform system and the pants & shoe program.'],
    [23, 2, 'Role Playbooks', 'Akron_Role_Playbooks.docx', 'Playbook', 'One page per position — purpose, standard, moments, training, uniform, and how each role is measured.'],
    [24, 3, 'Org & Accountability Structure', 'Akron_Org_And_Accountability.docx', 'Structure', 'Who runs what and who answers to whom — the operator layer, the reports-to map, and one owner per function.'],
    [25, 3, 'Staffing & Scheduling Standard', 'Akron_Staffing_And_Scheduling.docx', 'Standard', 'Coverage ratios, the nights/weekends parity model, and the hard staffing floor.'],
    [26, 3, 'The Handoff Standard', 'Akron_The_Handoff_Standard.docx', 'Standard', 'Structured, documented, warm handoffs (SBAR) so nothing drops at the seams between roles and shifts.'],
    [27, 4, 'The Safeguards', 'Akron_The_Safeguards.docx', 'Protocol', 'Communications & privacy, the AMA cluster/contagion protocol, and incident review.'],
    [28, 4, 'Clinical Excellence Framework', 'Akron_Clinical_Excellence_Framework.docx', 'Framework', 'The scaffold for clinical leadership — the nine clinical-core areas the Medical Director & DON own and fill.'],
    [29, 4, 'The Listening System', 'Akron_The_Listening_System.docx', 'System', 'Every survey — patient, staff, referral, family — with cadence and questions.'],
    [30, 4, 'Monthly Excellence Scorecard', 'Akron_Monthly_Excellence_Scorecard.xlsx', 'Tool', 'Every KPI on one page — the dashboard the monthly review runs on.'],
    [31, 5, 'The First 30 Days', 'Akron_The_First_30_Days.docx', 'Plan', "The CEO's founding-month implementation plan — sequenced, with owners."],
    [32, 5, 'The Daily Lineup', 'Akron_The_Daily_Lineup.docx', 'Playbook', 'The ten-minute every-shift ritual that keeps the whole system alive.'],
  ];
  const pad = (n) => String(n).padStart(2, '0');
  for (const [no, sec, title, file, type, what] of DOCS) {
    const fullTitle = `${pad(no)} · ${title}`;
    const body = `${what}\n\n— The Akron Standard · ${SECTIONS[sec].replace(/^\d+ · /, '')} · Read #${no}\nType: ${type} · Source file: ${file}\n\n[Full document not yet loaded. Edit this entry and paste the document text here when ready.]`;
    ensureDoc(SECTIONS[sec], fullTitle, body, `akron standard, ${type.toLowerCase()}`);
  }
}
seedAkronStandard();

// ---- Real document content (extracted from the uploaded Akron/Armada .docx
// files) lives in library-content.json. Upsert it into the Library: update the
// body of a matching Akron index placeholder if present, else insert fresh.
// Only overwrites a placeholder body (one still containing the "not yet loaded"
// marker) so hand-edited docs are never clobbered. ----
function seedLibraryContent() {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(path.join(__dirname, 'library-content.json'), 'utf8')); }
  catch { return; }
  const find = db.prepare(`SELECT id, body FROM docs WHERE title = ?`);
  const upd = db.prepare(`UPDATE docs SET body = ?, category = ?, tags = ?, updated_by = 'Armada Standard', updated_at = datetime('now') WHERE id = ?`);
  const ins = db.prepare(`INSERT INTO docs (title, category, body, tags, updated_by) VALUES (?, ?, ?, ?, 'Armada Standard')`);
  for (const d of items) {
    if (!d.title || !d.body) continue;
    const ex = find.get(d.title);
    if (ex) { if (/not yet loaded/i.test(ex.body || '')) upd.run(d.body, d.category, d.tags || null, ex.id); }
    else ins.run(d.title, d.category || 'Policy', d.body, d.tags || null);
  }
}
seedLibraryContent();

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
// Invite-based signup + approved-domain accounts.
addColumn('users', 'email', 'TEXT');
addColumn('users', 'pending', 'INTEGER');         // 1 = invited, hasn't set a password yet
addColumn('users', 'invite_token', 'TEXT');       // sha256 of the emailed invite token
addColumn('users', 'invite_expires', 'TEXT');
addColumn('users', 'invited_at', 'TEXT');
addColumn('users', 'invited_by', 'TEXT');
addColumn('beds', 'gender', 'TEXT');   // detox bed designation: Male | Female | Any
// Role rename: in-house kitchen → external caterer.
try { db.prepare(`UPDATE users SET job_role='Catering / Dietary' WHERE job_role='Kitchen'`).run(); } catch { /* ok */ }
// One-time: drop the default "Issue ID band / wristband" front-desk arrival step (not used).
try { if (getState('migr_drop_idband') !== 'done') { db.prepare(`UPDATE arrival_items SET active=0 WHERE role='Front Desk' AND label='Issue ID band / wristband'`).run(); setState('migr_drop_idband', 'done'); } } catch { /* ok */ }
// One-time: relabel the front-desk "notify team" step — it now auto-alerts the care team.
try { if (getState('migr_intake_notify') !== 'done') { db.prepare(`UPDATE arrival_items SET label='Intake complete — notify nurse, techs & CM for assessment (auto-alerts the team)' WHERE label='Notify the team a new admit is here (nurse + tech + CM)'`).run(); setState('migr_intake_notify', 'done'); } } catch { /* ok */ }

// Client belongings / valuables — chain of custody with dual control. Money is a
// tracked trust balance (not loose cash); every touch is signed + time-stamped.
db.exec(`
CREATE TABLE IF NOT EXISTS property_meta (
  client_id INTEGER PRIMARY KEY, safe_location TEXT, bag_number TEXT, sealed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open', intake_by TEXT, intake_witness TEXT, intake_client_ack TEXT, intake_at TEXT
);
CREATE TABLE IF NOT EXISTS property_items (
  id INTEGER PRIMARY KEY, client_id INTEGER, category TEXT, description TEXT, qty INTEGER DEFAULT 1,
  est_value REAL, condition TEXT, status TEXT DEFAULT 'stored',
  stored_at TEXT DEFAULT (datetime('now')), returned_at TEXT, by TEXT
);
CREATE TABLE IF NOT EXISTS property_events (
  id INTEGER PRIMARY KEY, client_id INTEGER, type TEXT, amount REAL, balance_after REAL,
  note TEXT, staff TEXT, witness TEXT, client_ack TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_property_items_client ON property_items(client_id);
CREATE INDEX IF NOT EXISTS idx_property_events_client ON property_events(client_id);
`);
// Person & belongings SEARCH checklist (consent, contraband found, disposed,
// sent-home, bins/luggage, meds handling) stored as JSON on the intake record.
addColumn('property_meta', 'search', 'TEXT');
// Per-diem revenue rates by ASAM level of care (admin-editable). Seed the four
// Armada bills today; other levels default to 0 until a rate is set.
if (!getState('loc_rates')) setState('loc_rates', JSON.stringify({ '3.7-WM': 442, '3.7': 342, '3.2-WM': 289, '3.5': 240 }));
// Expenses / budget. Payroll actual is derived from covered shifts × hours × pay
// rate (per-person, role fallback), with weekly overtime > 40h at 1.5×.
addColumn('users', 'hourly_rate', 'REAL');   // per-person hourly wage (admin-set)
addColumn('staffing_standard', 'rate', 'REAL');   // budgeted hourly rate for this model line → payroll budget
if (!getState('shift_hours')) setState('shift_hours', JSON.stringify({ Morning: 8, Day: 8, Evening: 8, Night: 8 }));
if (!getState('role_rates')) setState('role_rates', JSON.stringify({}));        // { 'BHT / Tech': 18, 'Nurse': 35, ... }
// Manual expense categories (Payroll is separate — its actual is auto-computed).
if (!getState('expense_cats')) setState('expense_cats', JSON.stringify(['Rent', 'Utilities', 'Food', 'Insurance', 'Supplies', 'Corporate Allocation']));
if (!getState('budget_monthly')) setState('budget_monthly', JSON.stringify({ Payroll: 0, Rent: 0 }));   // budget per category name
if (!getState('expense_actuals')) setState('expense_actuals', JSON.stringify({}));   // { 'YYYY-MM': { Rent: 0, ... } } until QuickBooks P&L
// One-time migration from the first cut (lowercase rent/payroll budget + rent_actual).
if (getState('expense_migrate_v1') !== 'done') {
  try {
    const b = JSON.parse(getState('budget_monthly') || '{}');
    if (b.rent != null || b.payroll != null) {
      const nb = {}; if (b.payroll != null) nb.Payroll = b.payroll; if (b.rent != null) nb.Rent = b.rent;
      for (const k in b) if (k !== 'rent' && k !== 'payroll') nb[k] = b[k];
      setState('budget_monthly', JSON.stringify(nb));
    }
    const ra = JSON.parse(getState('rent_actual') || '{}');
    if (Object.keys(ra).length) {
      const ea = JSON.parse(getState('expense_actuals') || '{}');
      for (const m in ra) { ea[m] = ea[m] || {}; ea[m].Rent = ra[m]; }
      setState('expense_actuals', JSON.stringify(ea));
    }
  } catch (e) { /* fresh install */ }
  setState('expense_migrate_v1', 'done');
}
// Census-driven (per-patient-per-day) expense lines: { Food: 12, ... }. A line
// with a PPD rate budgets as ppd × census × days instead of a flat amount.
if (!getState('ppd_lines')) setState('ppd_lines', JSON.stringify({}));
// Salaried roles not on the shift schedule — added to the payroll budget.
if (!getState('salaried_roles')) setState('salaried_roles', JSON.stringify([
  { title: 'Executive Director', monthly: 0 },
  { title: 'BD Rep', monthly: 0 },
  { title: 'Director of Operations', monthly: 0 },
  { title: 'Medical Director', monthly: 0 },
  { title: 'Nurse Practitioner', monthly: 0 },
]));
// Labor burden applied on top of all gross payroll (hourly + salaried): employer
// payroll taxes (FICA/FUTA/SUTA/workers' comp) and benefits, as % of wages.
if (!getState('payroll_burden')) setState('payroll_burden', JSON.stringify({ tax: 7.65, benefits: 0 }));
// Add Corporate Allocation as a standing expense line (one-time, idempotent).
if (getState('expense_corp_alloc_v1') !== 'done') {
  try {
    const cats = JSON.parse(getState('expense_cats') || '[]');
    if (Array.isArray(cats) && !cats.some((c) => String(c).toLowerCase() === 'corporate allocation')) {
      cats.push('Corporate Allocation'); setState('expense_cats', JSON.stringify(cats));
    }
  } catch (e) { /* ignore */ }
  setState('expense_corp_alloc_v1', 'done');
}
// Import the real P&L chart of accounts + May 2026 actuals (from the uploaded
// QuickBooks P&L) so every line is budget-vs-actual. One-time; budgets/edits made
// after this are preserved. pl_groups gives each line its P&L grouping.
if (getState('pl_import_may2026_v1') !== 'done') {
  const CHART = [
    ['Marketing', 'Advertising & Marketing', 4134.81], ['SEO', 'Advertising & Marketing', 255.32],
    ['Business Development-Operations', '', 884.04],
    ['Client Meals', 'Client Service Costs', 22040.12], ['Client Supplies', 'Client Service Costs', 2414.03], ['Client Transportation', 'Client Service Costs', 3680.75],
    ['Bank fees & Service charges', 'Dues, Fees & Subscriptions', 417.12], ['Billing Charges', 'Dues, Fees & Subscriptions', 574.17], ['Late Fees', 'Dues, Fees & Subscriptions', 81.79],
    ['HR & Personnel', '', 266.29],
    ['Liability Insurance', 'Insurance', 4179.37],
    ['Licensing & Credentialing Consulting', '', 510.0],
    ['Management Fee', '', 20000.0],
    ['Equipment rental', 'Office & Administrative', 358.4], ['Office Supplies', 'Office & Administrative', 711.7],
    ['Rent', 'Operating Occupancy Costs', 38457.0], ['Repairs & Maintenance', 'Operating Occupancy Costs', 688.54], ['Utilities', 'Operating Occupancy Costs', 3490.7], ['Internet, Wifi & TV Services', 'Operating Occupancy Costs', 90.0],
    ['Employee Benefits', 'Payroll & Benefits', 4816.01], ['Payroll Processing Fees', 'Payroll & Benefits', 1624.9], ['Payroll Taxes', 'Payroll & Benefits', 11954.38], ['Salaries & Wages', 'Payroll & Benefits', 150273.77], ['Workers Compensation', 'Payroll & Benefits', 1530.57],
    ['Software Expense', '', 6874.76], ['Travel', '', 2118.79],
  ];
  setState('expense_cats', JSON.stringify(CHART.map((r) => r[0])));
  const groups = {}; CHART.forEach((r) => { groups[r[0]] = r[1]; }); setState('pl_groups', JSON.stringify(groups));
  let ea = {}; try { ea = JSON.parse(getState('expense_actuals') || '{}'); } catch (e) { ea = {}; }
  const may = ea['2026-05'] || {}; CHART.forEach((r) => { if (may[r[0]] == null) may[r[0]] = r[2]; }); ea['2026-05'] = may;
  setState('expense_actuals', JSON.stringify(ea));
  setState('pl_import_may2026_v1', 'done');
}

db.exec(`
CREATE TABLE IF NOT EXISTS role_profiles (
  role TEXT PRIMARY KEY, side TEXT, purpose TEXT, qualities TEXT, responsibilities TEXT, interview TEXT,
  updated_by TEXT, updated TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, role TEXT, side TEXT,
  stage TEXT DEFAULT 'Applied', source TEXT, rating INTEGER, scores TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), by TEXT
);
`);
addColumn('meal_feedback', 'dish', 'TEXT');   // snapshot of the dish served (from the menu)
addColumn('alerts', 'roles', 'TEXT');          // pipe-wrapped roles this alert pertains to (NULL = everyone)
addColumn('clients', 'consent_on_file', 'INTEGER');
addColumn('clients', 'anchor_why', 'TEXT');
// Daily roster / attendance: supervisor's present-or-not mark + who covered a call-off.
addColumn('schedule_assignments', 'attendance', 'TEXT');       // present | absent | null (unmarked)
addColumn('schedule_assignments', 'attendance_by', 'TEXT');
addColumn('schedule_assignments', 'attendance_at', 'TEXT');
addColumn('schedule_assignments', 'covered_by_name', 'TEXT');  // who stepped in for a call-off
addColumn('schedule_assignments', 'covered_by_id', 'INTEGER');
addColumn('schedule_slots', 'shift_label', 'TEXT');            // weekly-grid label e.g. "Intake · 7:00 AM"
addColumn('schedule_slots', 'template_id', 'INTEGER');         // which shift-row created it
addColumn('manual_on_shift', 'for_date', 'TEXT');              // local business day (APP_TZ) the entry is for
addColumn('wows', 'principle', 'TEXT');                        // the day's principle this story lived out
addColumn('wows', 'client_response', 'TEXT');                  // how the client responded (the impact)
// Analytics dimensions: time-of-admit + staff attribution + discharge destination.
addColumn('clients', 'admit_time', 'TEXT');            // HH:MM (24h) — for time-of-admit analysis
addColumn('clients', 'therapist', 'TEXT');             // primary therapist (for outcome attribution)
addColumn('clients', 'case_manager', 'TEXT');          // case manager
addColumn('clients', 'discharge_destination', 'TEXT'); // where they went (facility/home/etc.)
addColumn('clients', 'kipu_id', 'TEXT');               // external EMR id (idempotent Kipu sync)
addColumn('clients', 'source', 'TEXT');                // kipu | warehouse | manual (null = manual)
addColumn('ama_reads', 'withdrawal_level', 'TEXT');    // None | Mild | Moderate | Severe | Unknown
addColumn('ama_reads', 'withdrawal_note', 'TEXT');
addColumn('ama_reads', 'med_concerns', 'TEXT');        // JSON array
// Leadership / clinical-director review signals (pulled from the same note read).
addColumn('ama_reads', 'step_down', 'TEXT');           // planned next level of care / destination
addColumn('ama_reads', 'transport', 'TEXT');           // Arranged | Needed | Unknown
addColumn('ama_reads', 'anticipated_dc', 'TEXT');      // anticipated discharge date (free text)
addColumn('ama_reads', 'discharge_plan', 'TEXT');      // 1-2 sentence step-down plan
addColumn('ama_reads', 'doc_flags', 'TEXT');           // JSON array of missing/late documentation
addColumn('ama_reads', 'unmet', 'TEXT');               // JSON array — in-stay needs we haven't addressed
addColumn('clients', 'loc', 'TEXT');                   // current ASAM level of care (parsed code)
addColumn('clients', 'referral_source', 'TEXT');       // who referred them in (for source→outcome trends)
// Demographics pulled from the Kipu census (these fields ARE in the census).
addColumn('clients', 'dob', 'TEXT');
addColumn('clients', 'diagnosis', 'TEXT');             // diagnosis_codes
addColumn('clients', 'insurance', 'TEXT');             // insurance_company
addColumn('clients', 'phone', 'TEXT');
addColumn('clients', 'pronouns', 'TEXT');
addColumn('clients', 'language', 'TEXT');              // preferred_language
addColumn('clients', 'mrn', 'TEXT');                   // medical record number
addColumn('clients', 'payment_method', 'TEXT');
addColumn('clients', 'next_loc', 'TEXT');              // Kipu next_level_of_care (planned step-down)
addColumn('clients', 'anticipated_dc', 'TEXT');        // Kipu anticipated_discharge_date
addColumn('clients', 'photo', 'TEXT');                 // patient photo (data URL) from Kipu, for face-matching
addColumn('clients', 'obs_interval', 'INTEGER');       // per-client observation cadence (minutes); null = default
addColumn('clients', 'summary', 'TEXT');               // AI at-a-glance snapshot (kept fresh)
addColumn('clients', 'summary_at', 'TEXT');            // when the snapshot was last updated
addColumn('clients', 'likes', 'TEXT');                 // what the client likes/enjoys (AI, kept fresh)
addColumn('clients', 'interests', 'TEXT');             // amenities/activities they love (Care Card) — drives engagement
addColumn('clients', 'aftercare_dest', 'TEXT');        // continuum: planned next step destination (Armada Outpatient / Partner / Home / Undecided)
addColumn('clients', 'aftercare_facility_id', 'INTEGER'); // if Partner, which approved facility
addColumn('facilities', 'preferred', 'INTEGER');       // 1 = approved reciprocal partner CMs may refer to
addColumn('clients', 'discharged_by_kipu', 'TEXT');    // who did the discharge in Kipu (best-effort), for accountability
addColumn('maintenance_requests', 'photo', 'TEXT');    // (legacy single photo — superseded by maintenance_photos)
addColumn('inventory_items', 'sku', 'TEXT');           // supplier/product code (e.g. PFS code) for ordering
addColumn('assigned_tasks', 'assigned_by_id', 'INTEGER'); // who created the task, so they can see responses
// Cleanup: older syncs sometimes saved the building/facility name (e.g. "Armada
// Recovery") into room when no bed was set. A real bed has a digit — clear the
// facility-name ones so the room shows blank, not wrong. Idempotent + self-healing.
db.exec(`UPDATE clients SET room = NULL WHERE room LIKE '%armada%' AND room NOT GLOB '*[0-9]*'`);
// One-time: the nourishment order (PFS-coded items) replaced a set of older generic
// Kitchen lines. Deactivate the generics so we're not double-counting the same thing
// under two names. Guarded by a state flag so it runs once and never fights a manual
// re-activation. (active=0 keeps history; it just drops them off the live count list.)
if (getState('nourish_dedup_v1') !== 'done') {
  const dupNames = [
    'Gatorade / electrolyte drinks', 'Fresh fruit', 'Snacks — chips/crackers',
    'Ginger ale', 'Protein boost — chocolate', 'Protein boost — vanilla',
    'Protein shakes', 'Jello', 'Yogurt (assorted)', 'Milk',
  ];
  const upd = db.prepare(`UPDATE inventory_items SET active = 0 WHERE name = ? COLLATE NOCASE`);
  dupNames.forEach((n) => upd.run(n));
  setState('nourish_dedup_v1', 'done');
}
// One-time: jelly is delivered in 200-packet boxes, so the unit + par need to match
// the real delivery (was 'case', par 3). ensureNourishment only backfills SKU, never
// touches unit/par on existing items, so fix the live rows here. Guarded so a manual
// in-app par tweak isn't overwritten on every boot.
if (getState('jelly_par_v1') !== 'done') {
  const jelly = db.prepare(
    `UPDATE inventory_items SET unit = 'box (200 packets)', par_level = 2, reorder_point = 1 WHERE name = ? COLLATE NOCASE`,
  );
  ['Jelly', 'Jelly, diet / sugar-free'].forEach((n) => jelly.run(n));
  setState('jelly_par_v1', 'done');
}
// One-time: merge the old fragmented Kitchen categories (Snacks, Beverages,
// Pantry, Hydration & Nutrition, Nurse Station) into the simplified 4-category
// scheme so there aren't two "snacks" sections. Non-food categories (Cutlery &
// Paper, Cleaning) are left alone. Guarded so manual recategorizing isn't undone.
if (getState('kitchen_cat_merge_v1') !== 'done') {
  const setCat = db.prepare(`UPDATE inventory_items SET category = ? WHERE department = 'Kitchen' AND category = ? AND active = 1`);
  setCat.run('Dry Goods & Snacks', 'Snacks');
  setCat.run('Drinks', 'Beverages');
  setCat.run('Drinks', 'Hydration & Nutrition');
  setCat.run('Condiments', 'Nurse Station');
  setCat.run('Condiments', 'Pantry');
  // Item-level exceptions that don't follow their old category's bulk move.
  const setItem = db.prepare(`UPDATE inventory_items SET category = ? WHERE name = ? COLLATE NOCASE AND department = 'Kitchen'`);
  setItem.run('Condiments', 'Creamer');               // was Beverages → Drinks, but it's a condiment
  setItem.run('Condiments', 'Sugar / sweetener packets');
  setItem.run('Fresh & Refrigerated', 'Butter');      // was Pantry → Condiments, but it's refrigerated
  setItem.run('Condiments', 'Peanut butter');         // was Pantry, belongs with condiments
  // Deactivate older generic walk-list items now duplicated by a coded nourishment
  // line in the same category (keeps history; drops them off the live count list).
  const deact = db.prepare(`UPDATE inventory_items SET active = 0 WHERE name = ? COLLATE NOCASE AND department = 'Kitchen'`);
  ['Coffee — decaf',                          // → 'Decaf coffee' (CF1574)
   'Sugar / sweetener packets',               // → 'Sweetener packets' (CN1210)
   'Hot chocolate / electrolyte packets',     // → 'Hot chocolate mix packets'
  ].forEach((n) => deact.run(n));
  setState('kitchen_cat_merge_v1', 'done');
}
// One-time: capture the peer recognition from the June 18 daily-lineup email
// replies into Kudos so it reaches the most-recognized board (the team replied
// before the paste-to-Kudos tool existed). Idempotent — guarded by a flag, and
// links to a teammate by name when one matches. No client-identifying details.
if (getState('lineup_kudos_2026_06_18') !== 'done') {
  const findU = db.prepare(`SELECT id, name FROM users WHERE active = 1 AND (lower(name) = lower(?) OR lower(name) LIKE lower(?)) LIMIT 1`);
  const insK = db.prepare(`INSERT INTO kudos (to_user_id, to_name, from_id, from_name, text) VALUES (?,?,?,?,?)`);
  const seed = [
    ['Maci', 'Shyanne Ferrebee', 'Comes in every day and keeps the facility clean and organized — does an amazing job and always has a smile, even on the hard days.'],
    ['Maci', 'Suzanne Parsons', 'While cleaning the upstairs floor, a resident asked where the snacks were and she walked him down to the dining room.'],
    ['Lynsey', 'Tracy Foss', 'Split her time between upstairs nurse and intake, taking on two admissions while a teammate was away — always jumps in and never complains.'],
    ['Sarah Lindsey', 'Jasmine Hodous', 'Recognized on the daily lineup for going above and beyond.'],
    ['Bre', 'Jasmine Hodous', 'Recognized on the daily lineup for going above and beyond.'],
  ];
  for (const [to, from, reason] of seed) {
    const u = findU.get(to, to + ' %');
    insK.run(u?.id || null, u?.name || to, null, from, '🙌 ' + reason);
  }
  setState('lineup_kudos_2026_06_18', 'done');
}
// One-time: the extra-mile / lived-the-value moments from the same June 18 replies
// (self-reported wins, not peer shout-outs) → the team morale wall. SEPARATE flag
// from the kudos seed above, which already deployed — otherwise this would never run.
if (getState('lineup_extra_mile_2026_06_18') !== 'done') {
  const insE = db.prepare(`INSERT INTO extra_mile (person, story, by_name, source) VALUES (?,?,?, 'lineup')`);
  const mile = [
    ['Jasmine Hodous', 'Stayed calm with a resident in crisis when their medication was unavailable — used de-escalation, active listening and reassurance, and kept them safe through the night.'],
    ['Tracy Foss', 'Went with a resident to dose, and when they missed lunch made sure a meal was saved for them.'],
    ['Suzanne Parsons', 'During an assessment, offered a resident an ice cream sandwich so they felt cared for — a small touch that made their day.'],
  ];
  for (const [person, story] of mile) insE.run(person, story, person);
  setState('lineup_extra_mile_2026_06_18', 'done');
}
// One-time: send concierge request alerts to Shlomo's email (per request).
if (getState('concierge_email_seed_v1') !== 'done') {
  setState('concierge_email', 'shlomo@armadarecovery.com');
  setState('concierge_email_seed_v1', 'done');
}
// One-time: set the Armada credo (the "Why we're here" on the lineup + 8am email)
// and the short daily credo + motto for the Gold Standards. Written with leadership.
if (getState('credo_seed_v1') !== 'done') {
  setState('purpose', "Everyone who comes to us wants to be better — but that hope is fragile, and detox is only the doorway. Our work is to make people feel so important and so genuinely cared for that they don't give up when it gets hard, and don't walk away when they feel a little better. We're not here to get someone through three days — we're here to reconnect them to why they came, show them a future is real, and set them up for the long road. So that years from now, they're still here to say it started with us.");
  setState('credo_short', "Detox is three days. Recovery is a life. Make these days the reason they don't quit.");
  setState('credo_motto', "We don't process patients — we give people their life back.");
  setState('credo_seed_v1', 'done');
}
// One-time: feature Jasmine as the current recognition-raffle winner on the
// lineup (per leadership). Auto-clears after a week; editable from the raffle UI.
if (getState('raffle_winner_seed_v1') !== 'done') {
  setState('raffle_winner', JSON.stringify({ name: 'Jasmine Hodous', reward: (getState('lineup_reward') || '').trim(), at: new Date().toISOString(), manual: true }));
  setState('raffle_winner_seed_v1', 'done');
}
// Multiple photos per work order (before/after, several angles). Client-resized JPEGs.
db.exec(`CREATE TABLE IF NOT EXISTS maintenance_photos (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  photo TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_photos ON maintenance_photos(request_id);`);
// Case-management needs the team should help with, pulled from the notes + manual.
db.exec(`CREATE TABLE IF NOT EXISTS case_tasks (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  category TEXT,
  item TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  source TEXT NOT NULL DEFAULT 'ai',     -- ai | manual
  done_by TEXT, done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
export const CASE_CATEGORIES = ['Aftercare / Housing', 'Transportation', 'Legal / Court / Parole', 'Employment', 'Education', 'Insurance / Financial', 'ID / Documents', 'Medical / Dental', 'Family / Support', 'Benefits', 'Communication', 'Other'];

// ---- ASAM levels of care: census breakdown, step-downs, length of stay ----
// `rank` orders the care journey (higher = more acute / earlier). A move to a
// LOWER rank is a step-down; a move to a higher rank is a step-up.
export const ASAM_LEVELS = [
  { code: '4.0',    label: '4.0 · Medically Managed Inpatient',     rank: 9 },
  { code: '3.7-WM', label: '3.7-WM · Medical Withdrawal Mgmt',      rank: 8 },
  { code: '3.7',    label: '3.7 · Medically Monitored Inpatient',   rank: 7 },
  { code: '3.2-WM', label: '3.2-WM · Residential Withdrawal Mgmt',  rank: 6 },
  { code: '3.5',    label: '3.5 · High-Intensity Residential',      rank: 5 },
  { code: '3.1',    label: '3.1 · Low-Intensity Residential',       rank: 4 },
  { code: '2.5',    label: '2.5 · Partial Hospitalization (PHP)',   rank: 3 },
  { code: '2.1',    label: '2.1 · Intensive Outpatient (IOP)',      rank: 2 },
  { code: '1.0',    label: '1.0 · Outpatient',                      rank: 1 },
  { code: 'Detox',       label: 'Detox (unspecified level)',        rank: 6 },
  { code: 'Residential', label: 'Residential (unspecified)',        rank: 5 },
  { code: 'Unspecified', label: 'Unspecified',                      rank: 0 },
];
export const LOC_RANK = Object.fromEntries(ASAM_LEVELS.map((l) => [l.code, l.rank]));
export const LOC_LABEL = Object.fromEntries(ASAM_LEVELS.map((l) => [l.code, l.label]));
// Map a free-text level_of_care / program string to a known ASAM code.
export function parseLoc(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return 'Unspecified';
  if (/3\.?7\s*-?\s*wm/.test(s)) return '3.7-WM';
  if (/3\.?2\s*-?\s*wm/.test(s)) return '3.2-WM';
  if (/\b4\.?0\b/.test(s)) return '4.0';
  if (/\b3\.?7\b/.test(s)) return '3.7';
  if (/\b3\.?5\b/.test(s)) return '3.5';
  if (/\b3\.?1\b/.test(s)) return '3.1';
  if (/\b2\.?5\b/.test(s) || /\bphp\b|partial hosp/.test(s)) return '2.5';
  if (/\b2\.?1\b/.test(s) || /\biop\b|intensive out/.test(s)) return '2.1';
  if (/\b1\.?0\b/.test(s) || /outpatient/.test(s)) return '1.0';
  if (/withdrawal|detox|\bwm\b/.test(s)) return 'Detox';
  if (/residential|\brtc\b/.test(s)) return 'Residential';
  return 'Unspecified';
}

// ---- Flow events + daily metrics: the running record of how the house moves.
// One event per real transition (admit / loc_change / discharge / ama), so a
// re-run of the sync never double-counts. daily_metrics rolls these up per day.
db.exec(`CREATE TABLE IF NOT EXISTS flow_events (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  kipu_id TEXT,
  kind TEXT NOT NULL,                     -- admit | loc_change | discharge | ama
  from_loc TEXT, to_loc TEXT,
  date TEXT NOT NULL,                     -- YYYY-MM-DD the event happened
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT PRIMARY KEY,                  -- YYYY-MM-DD
  intakes INTEGER NOT NULL DEFAULT 0,
  discharges INTEGER NOT NULL DEFAULT 0,
  loc_changes INTEGER NOT NULL DEFAULT 0,
  ama INTEGER NOT NULL DEFAULT 0,
  census INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS revenue_days (
  date TEXT NOT NULL,                     -- YYYY-MM-DD billed
  client_id INTEGER NOT NULL,
  loc TEXT,                               -- the ASAM level the client was at that day
  rate INTEGER NOT NULL DEFAULT 0,        -- per-diem billed for that day
  UNIQUE(date, client_id)
);
CREATE INDEX IF NOT EXISTS idx_revenue_days_date ON revenue_days(date);`);
// The facility's local day boundary. Daily flow is cut off at LOCAL midnight
// (default US Eastern) so the daily report matches what staff see on the floor,
// not UTC. Set APP_TZ to override (e.g. America/Chicago).
export const APP_TZ = process.env.APP_TZ || 'America/New_York';
export function appToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(d); // YYYY-MM-DD
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// UTC [start, end) datetime strings ("YYYY-MM-DD HH:MM:SS") bounding one APP_TZ
// calendar day. Lets UTC-stored timestamps (clock punches) be matched to the
// local (Eastern) business day without relying on the server process timezone.
export function dayBoundsUtc(dateStr) {
  const offsetMs = (instant) => {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {}; for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return asUTC - instant.getTime();
  };
  const midnightUtc = (ds) => { const g = new Date(ds + 'T00:00:00Z'); return new Date(g.getTime() - offsetMs(g)); };
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { start: fmt(midnightUtc(dateStr)), end: fmt(midnightUtc(addDays(dateStr, 1))) };
}
// Recompute a day's metrics from its flow events (idempotent upsert).
export function rollupDailyMetrics(date) {
  // Only count events still tied to a live client — events orphaned by a
  // Rebuild (client_id set NULL or pointing at a deleted row) must not inflate
  // the daily intake/discharge/AMA counts.
  const c = (k) => db.prepare(`SELECT COUNT(*) n FROM flow_events
    WHERE date = ? AND kind = ? AND client_id IN (SELECT id FROM clients)`).get(date, k).n;
  const ama = c('ama');
  const census = db.prepare(`SELECT COUNT(*) n FROM clients WHERE active = 1 AND discharge_status IS NULL`).get().n;
  db.prepare(`INSERT INTO daily_metrics (date, intakes, discharges, loc_changes, ama, census, updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(date) DO UPDATE SET intakes=excluded.intakes, discharges=excluded.discharges,
      loc_changes=excluded.loc_changes, ama=excluded.ama, census=excluded.census, updated_at=datetime('now')`)
    .run(date, c('admit'), c('discharge') + ama, c('loc_change'), ama, census);
}

// ---- Observation / safety rounds: every client checked on a cadence, logged
// with who + when, so compliance is provable even when no one is watching. ----
db.exec(`CREATE TABLE IF NOT EXISTS obs_checks (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ok',     -- ok | asleep | concern | refused | off-unit
  note TEXT,
  by_name TEXT,
  source TEXT NOT NULL DEFAULT 'app',     -- app | kipu
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_client_ts ON obs_checks(client_id, ts);`);
addColumn('obs_checks', 'kipu_eval_id', 'TEXT');   // source eval id, so Kipu-charted rounds dedupe
addColumn('clients', 'doc_forms', 'TEXT');          // JSON: which key Kipu forms exist on the chart

// ---- Rounds scan verification: a QR at the FARTHEST point of each room/area, so a
// "round" is only credited when staff physically walk there and scan it. Scanning a
// room point also logs a verified obs_check for the client(s) in that room.
db.exec(`CREATE TABLE IF NOT EXISTS scan_points (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,                 -- random token embedded in the QR
  label TEXT NOT NULL,                       -- e.g. "Room A06" / "Dining room" / "Lounge"
  area TEXT NOT NULL DEFAULT 'Room',         -- Room | Common
  room TEXT,                                 -- links a Room point to client room(s)
  active INTEGER NOT NULL DEFAULT 1,
  active_from INTEGER,                        -- local hour 0-23 the point is expected from (NULL = 24/7)
  active_to INTEGER,                          -- local hour 0-23 the point is expected until (wraps midnight if from>to)
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS round_scans (
  id INTEGER PRIMARY KEY,
  point_id INTEGER REFERENCES scan_points(id) ON DELETE CASCADE,
  code TEXT,
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  source TEXT NOT NULL DEFAULT 'scan',       -- scan | manual (typed code, e.g. damaged QR)
  flagged INTEGER NOT NULL DEFAULT 0,        -- 1 = looks like a replay/burst (review)
  flag_reason TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_round_scans_ts ON round_scans(ts);
CREATE INDEX IF NOT EXISTS idx_round_scans_point ON round_scans(point_id, ts);`);
addColumn('scan_points', 'active_from', 'INTEGER');   // day/night windows (existing deploys)
addColumn('scan_points', 'active_to', 'INTEGER');
addColumn('round_scans', 'flagged', 'INTEGER');       // replay/burst flag (existing deploys)
addColumn('round_scans', 'flag_reason', 'TEXT');
addColumn('round_scans', 'photo', 'TEXT');            // camera frame at scan time (paper vs phone-screen review)
// Concierge requests: assignment + response-time tracking.
addColumn('requests', 'assigned_to', 'INTEGER');
addColumn('requests', 'assigned_name', 'TEXT');
addColumn('requests', 'acknowledged_at', 'TEXT');     // first time someone picked it up (time-to-response)
addColumn('requests', 'acknowledged_by', 'TEXT');

// ---- Medical send-outs: ED/hospital trips (the "OTHER" section of the census).
// A client physically sent out for medical care — still on our census until
// formally discharged, tracked separately. ----
db.exec(`CREATE TABLE IF NOT EXISTS medical_sendouts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  destination TEXT,
  reason TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_by TEXT,
  status TEXT NOT NULL DEFAULT 'out',     -- out | returned | admitted_elsewhere
  returned_at TEXT, returned_by TEXT, note TEXT
);`);

// ---- Dignity Kit: every client gets one; delivery must be confirmed by the
// owner, and anyone who lets it go overdue is tracked. One kit per client. ----
db.exec(`CREATE TABLE IF NOT EXISTS dignity_kits (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'needed',     -- needed | delivered | na
  needed_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_by TEXT,
  assigned_role TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_name TEXT,
  delivered_by TEXT, delivered_at TEXT,
  note TEXT,
  UNIQUE(client_id)
);`);

// ---- Leadership: the Director's Daily Review (Brandon's recurring rounds) ----
// One checklist instance per day, seeded from DIRECTOR_REVIEW on first open.
db.exec(`CREATE TABLE IF NOT EXISTS command_checklist (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  section TEXT NOT NULL,
  item TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',     -- open | done | na
  note TEXT,
  done_by TEXT, done_at TEXT,
  UNIQUE(date, section, item)
);`);
// The standing review routine, grouped the way a director actually rounds.
export const DIRECTOR_REVIEW = [
  ['Census & Billing', 'Billing census updated for this morning (and as admits/discharges happen)'],
  ['Census & Billing', 'At least one face-to-face service documented for every client today'],
  ['Flow', 'Today\'s admissions reviewed (intake packet started)'],
  ['Flow', 'Today\'s discharges reviewed (AMA vs. completed vs. transfer)'],
  ['Flow', 'LOC changes reviewed — clients notified of the change'],
  ['3.2-WM / Detox', 'Every 3.2-WM client checked — anyone past day 4 not yet stepped down?'],
  ['3.2-WM / Detox', 'Detox→residential transfers confirmed; "not sure" clients have a documented conversation'],
  ['Discharge Planning', 'Residential→PHP/other-service destinations confirmed with location'],
  ['Discharge Planning', 'Anticipated discharge dates current; transportation arranged where needed'],
  ['Groups', 'Groups completed on time today; topics varied and on the schedule'],
  ['Groups', 'Group notes completed with attendance + signatures'],
  ['Assessments', 'CM needs assessment done day of admission for new admits'],
  ['Assessments', 'Biopsychosocial within 24h; initial Tx plan + ASAM completed'],
  ['LOC Transfers', 'ASAM for residential + individualized Tx plan completed'],
  ['LOC Transfers', 'Jane notified for authorization; auth entered into Kipu'],
  ['Documentation', 'CM + individual counseling progress notes current for each client'],
  ['Documentation', 'Discharge-planning process documented for active clients'],
  ['RTs (paper)', 'Intake checklist, belongings search + inventory completed for new admits'],
  ['RTs (paper)', 'Hourly rounds + shift checklists completed; beds cleaned, turnaround on track'],
  ['Staffing', 'Adequate staff on every shift today; call-offs covered'],
];

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

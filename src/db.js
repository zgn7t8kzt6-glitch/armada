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
-- Belonging pulse (the plan's leading indicator): 3 anonymous 1-10 ratings —
-- "I feel part of something here / My input is heard / I'm treated with respect."
CREATE TABLE IF NOT EXISTS belonging_pulses (
  id INTEGER PRIMARY KEY,
  q1 INTEGER, q2 INTEGER, q3 INTEGER,        -- 1-10 each
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
  quality INTEGER,                          -- 1–10 (optional)
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
addColumn('clients', 'discharge_evidence', 'TEXT');       // the specific in-stay note the reason is grounded in
addColumn('clients', 'discharge_doc_gap', 'INTEGER');     // 1 = only intake/no in-stay notes were available to debrief
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
try { db.prepare(`UPDATE users SET job_role='Executive Assistant' WHERE job_role='Corporate'`).run(); } catch { /* ok */ }
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
// Real drawn client signatures (data-URL PNG) captured on the device.
addColumn('property_meta', 'intake_client_sig', 'TEXT');
addColumn('property_events', 'client_sig', 'TEXT');
addColumn('property_events', 'photo', 'TEXT');   // photo of the counted cash on a deposit
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
addColumn('role_profiles', 'limitations', 'TEXT');   // what's out of this role's lane (JSON array)
addColumn('meal_checks', 'served_at', 'TEXT');       // HH:MM the meal was actually served (timeliness)
addColumn('incidents', 'needs_contract', 'INTEGER'); // 1 = this incident calls for a behavioral contract
addColumn('alerts', 'shift', 'TEXT');        // which shift this alert belongs to (clears each shift)
addColumn('alerts', 'shift_date', 'TEXT');   // YYYY-MM-DD the alert's shift started
addColumn('alerts', 'expires_at', 'TEXT');   // optional TTL — past this an unacked alert auto-misses (e.g. rounds @ 1h)
// BEHAVIORAL CONTRACTS — an agreement with a client about expectations after an
// incident. RTs can log information/observations against an existing one; clinical
// owns the terms. A running note log keeps the chain of who-said-what.
db.exec(`CREATE TABLE IF NOT EXISTS behavior_contracts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Active',     -- Active | Closed
  reason TEXT, terms TEXT,
  incident_id INTEGER,
  started_by_id INTEGER REFERENCES users(id), started_by_name TEXT,
  closed_at TEXT, closed_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS behavior_contract_notes (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER REFERENCES behavior_contracts(id) ON DELETE CASCADE,
  note TEXT NOT NULL, by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS behavior_checkins (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER REFERENCES behavior_contracts(id) ON DELETE CASCADE,
  client_id INTEGER,
  shift_date TEXT NOT NULL, shift TEXT NOT NULL,
  rating TEXT,                               -- Better | Holding | Worse
  note TEXT, by_id INTEGER, by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(contract_id, shift_date, shift)
);`);
// SNACK STATION — was the snack/coffee/juice station stocked, and when? Respect = the
// little things are always there. One row per stock-up, newest wins for "stocked now".
db.exec(`CREATE TABLE IF NOT EXISTS snack_checks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  snacks INTEGER, coffee INTEGER, juice INTEGER,
  note TEXT, by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// SHIFT REPORT — the unit-level pass-down each shift writes for the next. One row
// per shift; the next shift reads it as the first thing on My Shift, then writes
// their own — an unbroken chain of "what you need to know."
db.exec(`CREATE TABLE IF NOT EXISTS shift_reports (
  id INTEGER PRIMARY KEY,
  shift_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  summary TEXT, watch TEXT, followups TEXT,
  census INTEGER,
  by_id INTEGER REFERENCES users(id), by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shift_date, shift)
);`);
addColumn('shift_reports', 'data', 'TEXT');   // structured pass-down answers (JSON)
addColumn('users', 'phone', 'TEXT');          // staff cell — for on-shift contact / call buttons
addColumn('users', 'last_login', 'TEXT');     // last successful sign-in (stamped in startSession)
// EMPLOYEE PROFILE — the staff version of a Care Card (admin/leadership only). What
// makes each person tick, plus a coaching log, so we can develop & recognize them well.
db.exec(`CREATE TABLE IF NOT EXISTS employee_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  likes TEXT, personality TEXT, motivators TEXT, recognition TEXT, notes TEXT,
  updated_by TEXT, updated TEXT
);
CREATE TABLE IF NOT EXISTS employee_notes (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
addColumn('employee_profiles', 'disc', 'TEXT');   // DISC-style personality read (JSON: D/I/S/C scores + primary)
addColumn('employee_profiles', 'bigfive', 'TEXT'); // Big Five + Honesty-Humility (HEXACO) scores (JSON)
addColumn('employee_profiles', 'sjt', 'TEXT');     // Situational-judgment scores (JSON: competency %s)
addColumn('employee_profiles', 'leadership', 'TEXT'); // Leadership Mirror: {style:{...}, judgment:{...}} (CEO + every leader)
// GROWTH PLAN — every employee's own goals (6mo / 1yr / 5yr / 10yr) and a monthly
// check-in: how they're tracking and how we can support them. Theirs to see & own.
db.exec(`CREATE TABLE IF NOT EXISTS growth_plans (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal_6m TEXT, goal_1y TEXT, goal_5y TEXT, goal_10y TEXT,
  why TEXT,
  updated TEXT, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS growth_checkins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  progress TEXT,                 -- how they're moving toward the goal
  support TEXT,                  -- what support would help them get closer
  by_name TEXT, self INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// ── ONE-TIME MIGRATION: 1–5 rating scales → app-wide 1–10 scale ──
// Every numeric rating moved from a five-point to a ten-point scale. Old data was
// stored on 1–5, so we double it (×2) — this preserves every historical proportion
// exactly (4/5 = 80% becomes 8/10 = 80%), so averages and trends stay correct.
// Guarded by PRAGMA user_version so it runs exactly once per database.
try {
  const uvRow = db.prepare('PRAGMA user_version').get();
  const uv = uvRow ? (uvRow.user_version != null ? uvRow.user_version : Object.values(uvRow)[0]) : 0;
  if (!uv || uv < 1) {
    const run = (sql) => { try { db.prepare(sql).run(); } catch (e) { console.error('[scale10]', e.message); } };
    run(`UPDATE belonging_pulses SET q1=q1*2, q2=q2*2, q3=q3*2 WHERE q1<=5 OR q2<=5 OR q3<=5`);
    run(`UPDATE meal_checks SET quality=quality*2 WHERE quality IS NOT NULL AND quality<=5`);
    run(`UPDATE client_experience SET cared=cared*2 WHERE cared IS NOT NULL AND cared<=5`);
    run(`UPDATE candidates SET rating=rating*2 WHERE rating IS NOT NULL AND rating<=5`);
    // Candidate per-quality scores live in a JSON column — double each numeric value.
    try {
      const rows = db.prepare(`SELECT id, scores FROM candidates WHERE scores IS NOT NULL AND scores != ''`).all();
      const upd = db.prepare(`UPDATE candidates SET scores=? WHERE id=?`);
      for (const r of rows) { try { const o = JSON.parse(r.scores); let ch = false; for (const k in o) { if (typeof o[k] === 'number' && o[k] <= 5) { o[k] = o[k] * 2; ch = true; } } if (ch) upd.run(JSON.stringify(o), r.id); } catch {} }
    } catch (e) { console.error('[scale10 scores]', e.message); }
    db.exec('PRAGMA user_version = 1');
  }
} catch (e) { console.error('[scale10 migration]', e.message); }
// LAUNDRY — track every load through washing → drying → folding → done so nothing
// sits wet or gets lost. Simple operational board (like bed turnover).
db.exec(`CREATE TABLE IF NOT EXISTS laundry_loads (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL, kind TEXT, client_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Washing',   -- Washing | Drying | Folding | Done
  note TEXT, started_by_id INTEGER, started_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// SHIFT CHECKLIST — the simple recurring walk-around duties staff confirm each
// shift (snacks filled, common areas tidy, eyes on every client…). Resets every
// shift; completion is keyed to (shift_date, shift) so a new shift starts fresh.
db.exec(`CREATE TABLE IF NOT EXISTS shift_tasks (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shift_task_done (
  id INTEGER PRIMARY KEY, task_id INTEGER REFERENCES shift_tasks(id) ON DELETE CASCADE,
  shift_date TEXT NOT NULL, shift TEXT NOT NULL, by_id INTEGER, by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(task_id, shift_date, shift)
);`);
if (!db.prepare(`SELECT COUNT(*) n FROM shift_tasks`).get().n) {
  const ins = db.prepare(`INSERT INTO shift_tasks (label, sort) VALUES (?, ?)`);
  [
    'Eyes on every client — all accounted for',
    'Snacks, coffee & juice stocked',
    'Common areas tidy — no clutter or trash',
    'Bathrooms clean & stocked (paper, towels)',
    'Laundry moving — washed / dried / folded',
    'Fresh linens & towels available',
    'Day room reset after groups',
    'Smoke area clean & supplies ready',
  ].forEach((l, i) => ins.run(l, i));
}
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
addColumn('maintenance_requests', 'facility', 'TEXT'); // which location the work order is for (multi-facility)
// Phase 2-4 HCOS tables: policy documents + acknowledgements, requisitions,
// pulse/eNPS surveys, compensation history.
db.exec(`CREATE TABLE IF NOT EXISTS hr_documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Policy',           -- Policy | Handbook | Safety | Benefits | Other
  body TEXT,                                -- the policy text (shown for acknowledgement)
  url TEXT,                                 -- or a link to the document
  requires_ack INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hr_doc_acks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES hr_documents(id) ON DELETE CASCADE,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(doc_id, user_id)
);
CREATE TABLE IF NOT EXISTS hr_requisitions (
  id INTEGER PRIMARY KEY,
  position TEXT NOT NULL,
  entity TEXT,
  department TEXT,
  salary_range TEXT,
  urgency TEXT DEFAULT 'Normal',            -- Low | Normal | High | Urgent
  replacement INTEGER NOT NULL DEFAULT 0,   -- 1 = replacing someone; 0 = new position
  justification TEXT,
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | filled
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hr_pulse (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  score INTEGER NOT NULL,                   -- 0-10 eNPS
  comment TEXT,
  month TEXT NOT NULL,                      -- YYYY-MM
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, month)
);
CREATE TABLE IF NOT EXISTS hr_comp_history (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  old_salary REAL,
  new_salary REAL,
  note TEXT,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Uploaded corporate documents (insurance contracts, leases). Stored as base64 so the
// AI can read them and they're downloadable.
db.exec(`CREATE TABLE IF NOT EXISTS corp_files (
  id INTEGER PRIMARY KEY,
  kind TEXT,                                   -- insurance | lease
  name TEXT,
  media_type TEXT,
  data TEXT,                                   -- base64
  size INTEGER,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
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
// ── Corporate Operations (Chava's hub): project/task board, vendors, facility docs ──
// A lightweight project-management board — anyone can drop a task; corporate works it.
db.exec(`CREATE TABLE IF NOT EXISTS corp_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT,
  category TEXT NOT NULL DEFAULT 'Project',   -- Project | Errand | Ordering | Maintenance | Admin | Morale
  status TEXT NOT NULL DEFAULT 'todo',        -- todo | doing | blocked | done
  priority TEXT NOT NULL DEFAULT 'Normal',    -- Low | Normal | High | Urgent
  facility TEXT,
  requested_by_id INTEGER REFERENCES users(id),
  requested_by TEXT,
  assignee TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_corp_tasks_status ON corp_tasks(status, priority);`);
// Vendor directory — who corporate calls to get things done, per facility/category.
db.exec(`CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,                              -- Supplies | Plumbing | Electrical | HVAC | IT | Landscaping | Utilities | Other
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  account_number TEXT,
  facility TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Facility documents & recurring info — leases, utilities, insurance, permits. Stores
// the structured facts + a link (file storage can come later); renewal_date drives reminders.
db.exec(`CREATE TABLE IF NOT EXISTS facility_docs (
  id INTEGER PRIMARY KEY,
  facility TEXT,
  doc_type TEXT NOT NULL DEFAULT 'Other',     -- Lease | Utility | Insurance | Permit/License | Internet/Phone | Contract | Other
  title TEXT NOT NULL,
  provider TEXT,
  account_number TEXT,
  amount TEXT,                                -- e.g. monthly cost / rent
  renewal_date TEXT,
  url TEXT,                                   -- link to the stored file (Drive/Dropbox/etc.)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Facility leases — the full record per property, including the lease TEXT so the AI
// lease assistant can answer "is X the landlord's responsibility?" grounded in the doc.
db.exec(`CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,                         -- which location / legal entity
  property_address TEXT,
  landlord TEXT,
  landlord_contact TEXT,
  monthly_rent TEXT,
  security_deposit TEXT,
  term_start TEXT,
  term_end TEXT,
  renewal_terms TEXT,
  responsibilities TEXT,                        -- quick notes on landlord/tenant split
  doc_url TEXT,                                 -- link to the signed lease PDF
  lease_text TEXT,                              -- pasted full text — powers the AI Q&A
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leases_entity ON leases(entity);
-- Q&A history so answers are saved and reusable.
CREATE TABLE IF NOT EXISTS lease_questions (
  id INTEGER PRIMARY KEY,
  lease_id INTEGER REFERENCES leases(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  asked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// ── Entity vault: legal + banking + cards + portal logins per legal entity ──────
// Highly sensitive; corp/owner-only, masked in the UI. Loaded via in-app import so
// the raw data never lives in the code repository.
db.exec(`CREATE TABLE IF NOT EXISTS entity_records (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  npi TEXT,
  taxonomy TEXT,
  medicaid_id TEXT,
  duns TEXT,
  address TEXT,
  mailing_address TEXT,
  incorp_date TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entity_bank_accounts (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  bank TEXT,
  routing TEXT,
  account_number TEXT,
  acct_type TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS entity_cards (
  id INTEGER PRIMARY KEY,
  entity TEXT,
  name_on_card TEXT,
  card_number TEXT,
  exp TEXT,
  front_code TEXT,
  back_code TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS portals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT,
  password TEXT,
  info TEXT,
  entity TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Corporate ordering stream — supply requests from ALL locations land here, tagged by
// facility, so Chava sees where everything is being requested and works one queue.
db.exec(`CREATE TABLE IF NOT EXISTS order_requests (
  id INTEGER PRIMARY KEY,
  facility TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty TEXT,
  category TEXT,
  vendor TEXT,
  link TEXT,                                  -- Amazon / supplier reorder link
  priority TEXT NOT NULL DEFAULT 'Normal',    -- Low | Normal | High | Urgent
  status TEXT NOT NULL DEFAULT 'requested',   -- requested | ordered | received | cancelled
  notes TEXT,
  est_cost TEXT,
  requested_by_id INTEGER REFERENCES users(id),
  requested_by TEXT,
  source TEXT,                                -- 'detox-auto' | 'manual'
  ordered_at TEXT, ordered_by TEXT,
  received_at TEXT, received_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_req ON order_requests(status, facility);`);
// Email-in order intake: routes that map an inbound email (by sender or by the
// to-address / +tag) to an entity, so an office manager's emailed order becomes
// order_requests for the right location.
db.exec(`CREATE TABLE IF NOT EXISTS order_intake_routes (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'sender' (from email) | 'address' (to-address or +tag)
  value TEXT NOT NULL,             -- the email/tag to match (lowercased)
  entity TEXT NOT NULL,
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intake_route ON order_intake_routes(kind, value);`);
// Payment methods & vendor account info per location. NOTE: never store full card
// numbers or CVV here (PCI risk) — hold reference info (last 4, which card) and keep
// raw numbers in a vault. account_number is for vendor/ACH accounts, not cards.
db.exec(`CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,                        -- e.g. "Amex — Akron ops"
  kind TEXT NOT NULL DEFAULT 'Card',          -- Card | ACH/Bank | Vendor account | Net terms
  brand TEXT,                                 -- Visa | Amex | ...
  last4 TEXT,
  exp TEXT,                                   -- MM/YY
  billing_zip TEXT,
  cardholder TEXT,
  account_number TEXT,                        -- vendor / ACH account (not a card PAN)
  vendor TEXT,
  facility TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// ── HCOS: Human Capital Operating System — the employee lifecycle spine ────────
// Certifications (HIPAA, CPR, licenses) with expiration watch; reviews (30/60/90/
// 6-month/annual); coaching log; employee-relations cases (progressive discipline +
// PIP); leave; onboarding checklists; and a per-employee event timeline.
db.exec(`CREATE TABLE IF NOT EXISTS hr_certifications (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  issued TEXT,
  expires TEXT,
  doc_url TEXT,
  notes TEXT,
  reminded TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hrcert_exp ON hr_certifications(expires);
CREATE TABLE IF NOT EXISTS hr_reviews (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                    -- 30-day | 60-day | 90-day | 6-month | Annual | Custom
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',    -- open | done
  rating INTEGER,                         -- 1-10
  summary TEXT,
  reviewer TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hrrev_due ON hr_reviews(status, due_date);
CREATE TABLE IF NOT EXISTS hr_coaching (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'positive',  -- positive | corrective | observation
  note TEXT NOT NULL,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hr_cases (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- Verbal | Written | Final Written | Suspension | Termination | PIP | Complaint | Investigation
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',    -- open | resolved
  resolution TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS hr_leave (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'PTO',       -- PTO | Vacation | Sick | FMLA | Bereavement | Jury Duty | Parental | Military
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'requested', -- requested | approved | denied
  approver TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hr_onboard_tasks (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  due_date TEXT,
  assigned_to TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hr_events (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT,
  by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hrev_emp ON hr_events(employee_id, id);`);
// ── BHOS FOUNDATION: canonical facilities, departments, access & permissions ────
// Phase 1 of the multi-facility reorganization. Additive only: these tables are the
// new spine; existing modules keep working unchanged until each one is switched to
// facility scoping (Phase 2+). Holdings (CGSS, SZS, Propco) are NOT facilities —
// they live in entity_records only.
db.exec(`CREATE TABLE IF NOT EXISTS org_facilities (
  id INTEGER PRIMARY KEY,
  fkey TEXT UNIQUE,                 -- stable key, e.g. 'detox-akron'
  name TEXT NOT NULL,
  brand TEXT,                       -- Armada | Spark | Hilltop | Reverie | Corporate
  region TEXT,                      -- Ohio | Indiana | Corporate
  type TEXT,                        -- detox | outpatient | sober-living | corporate
  kipu_location_name TEXT,          -- how Kipu names it (blank = not in Kipu)
  entity_aliases TEXT,              -- JSON array of entity-name spellings that map here
  beds INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS org_departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_facility_access (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id INTEGER NOT NULL REFERENCES org_facilities(id) ON DELETE CASCADE,
  role TEXT,                        -- role at THIS facility (defaults to users.job_role)
  UNIQUE(user_id, facility_id)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,               -- job_role or 'admin'
  module TEXT NOT NULL,             -- corporate|facility_ops|admissions|census|clinical|casemgmt|peer|ur|billing|hr|finance|bd|compliance|scheduling|documents|tasks|reports|admin
  action TEXT NOT NULL DEFAULT 'view',  -- view|create|edit|approve|delete|export
  scope TEXT NOT NULL DEFAULT 'facility', -- corporate|regional|facility|department|assigned_only|self_only
  allowed INTEGER NOT NULL DEFAULT 1,
  UNIQUE(role, module, action)
);`);
// facility_id on the core operating records — nullable, backfilled to Armada Detox
// of Akron below. NO existing query filters on these yet (Phase 2 flips scoping
// module-by-module), so behavior is unchanged.
addColumn('clients', 'facility_id', 'INTEGER');
addColumn('shifts', 'facility_id', 'INTEGER');
addColumn('inventory_items', 'facility_id', 'INTEGER');
addColumn('incidents', 'facility_id', 'INTEGER');
addColumn('expected_arrivals', 'facility_id', 'INTEGER');
addColumn('admissions', 'facility_id', 'INTEGER');
// One-time seed + backfill (gated).
try {
  const done = db.prepare(`SELECT value FROM app_state WHERE key='org_foundation_v1'`).get();
  if (!done) {
    const insF = db.prepare(`INSERT INTO org_facilities (fkey,name,brand,region,type,kipu_location_name,entity_aliases,sort) VALUES (?,?,?,?,?,?,?,?)`);
    const F = [
      ['detox-akron','Armada Detox of Akron','Armada','Ohio','detox','', ['Armada Detox of Akron','Armada Detox of Akron LLC']],
      ['akron-house','Armada Recovery of Akron','Armada','Ohio','outpatient','Akron House Recovery', ['Akron House Recovery, LLC','Akron House Recovery LLC']],
      ['dayton','Armada Recovery of Dayton','Armada','Ohio','outpatient','Dayton', ['Armada Recovery Dayton, LLC','Armada Recovery of Dayton LLC']],
      ['hilltop-akron','Hilltop Recovery Home — Akron','Hilltop','Ohio','sober-living','', ['Hilltop Recovery Home, LLC - AKRON','Hilltop Recovery Home (AKRON) LLC']],
      ['hilltop-dayton','Hilltop Recovery Home — Dayton','Hilltop','Ohio','sober-living','', ['Hilltop Recovery Dayton, LLC','Hilltop Recovery Home of DAYTON, LLC']],
      ['spark-indy','Spark Recovery of Indianapolis','Spark','Indiana','outpatient','Indianapolis', ['Spark Recovery, LLC','Spark Recovery of Indiana, LLC']],
      ['reverie-indy','Reverie Sober Living of Indianapolis','Reverie','Indiana','sober-living','', ['Reverie Sober Living of Indianapolis','Reverie Sober Living of Indianapolis LLC']],
      ['wheatfield','Armada Recovery of Wheatfield','Armada','Indiana','outpatient','Wheatfield', ['Armada Recovery of Wheatfield LLC','Wheatfield Recovery Propco LLC']],
      ['corporate','Armada Recovery LLC (Corporate)','Corporate','Corporate','corporate','', ['Armada Recovery LLC ("Corporate")','Armada Recovery  LLC','armada Recovery LLC ("Corporate")']],
    ];
    F.forEach((f,i)=>insF.run(f[0],f[1],f[2],f[3],f[4],f[5],JSON.stringify(f[6]),i));
    const insD = db.prepare(`INSERT OR IGNORE INTO org_departments (name,sort) VALUES (?,?)`);
    ['Nursing','Clinical / Therapy','Case Management','BHT / Direct Care','Front Desk / Admissions','Kitchen / Dietary','Housekeeping','Maintenance','Housing','Peer Support','Administration','HR','Finance','Business Development'].forEach((n,i)=>insD.run(n,i));
    // Backfill: every existing operating record belongs to the detox facility.
    const detox = db.prepare(`SELECT id FROM org_facilities WHERE fkey='detox-akron'`).get().id;
    for (const t of ['clients','shifts','inventory_items','incidents','expected_arrivals','admissions']) {
      try { db.prepare(`UPDATE ${t} SET facility_id=? WHERE facility_id IS NULL`).run(detox); } catch { /* table may be empty */ }
    }
    // user_facility_access seed replicating today's walls: housing roles → Hilltop
    // Akron; corporate/HR/leadership + admins → all facilities; everyone else → detox.
    const facs = db.prepare(`SELECT id FROM org_facilities WHERE active=1`).all().map(r=>r.id);
    const hilltopAkron = db.prepare(`SELECT id FROM org_facilities WHERE fkey='hilltop-akron'`).get().id;
    const insA = db.prepare(`INSERT OR IGNORE INTO user_facility_access (user_id,facility_id,role) VALUES (?,?,?)`);
    for (const u of db.prepare(`SELECT id, role, job_role FROM users WHERE active=1`).all()) {
      const jr = u.job_role || '';
      if (u.role==='admin' || ['Executive Director','Executive Assistant','HR'].includes(jr)) facs.forEach(f=>insA.run(u.id,f,jr||'admin'));
      else if (['Housing Director','House Manager','Recovery Coach'].includes(jr)) insA.run(u.id,hilltopAkron,jr);
      else insA.run(u.id,detox,jr);
    }
    // role_permissions seed (view-level, replicates current walls; enforcement is
    // Phase 2 and switches on module-by-module — nothing reads these yet).
    const insP = db.prepare(`INSERT OR IGNORE INTO role_permissions (role,module,action,scope) VALUES (?,?,'view',?)`);
    const ALLM = ['corporate','facility_ops','admissions','census','clinical','casemgmt','peer','ur','billing','hr','finance','bd','compliance','scheduling','documents','tasks','reports','admin'];
    for (const m of ALLM) { insP.run('admin',m,'corporate'); insP.run('Executive Director',m,'corporate'); }
    for (const m of ['facility_ops','admissions','census','clinical','casemgmt','scheduling','compliance','tasks','reports']) insP.run('Director of Operations',m,'facility');
    for (const m of ['clinical','census','casemgmt','admissions','compliance','tasks','reports','scheduling']) insP.run('Clinical Director',m,'facility');
    for (const m of ['clinical','census','casemgmt','tasks']) { insP.run('Nurse',m,'facility'); insP.run('BHT / Tech',m,'facility'); insP.run('Therapist',m,'facility'); insP.run('Case Manager',m,'facility'); }
    for (const m of ['admissions','census','bd','tasks']) insP.run('Front Desk',m,'facility');
    for (const m of ['facility_ops','tasks']) { insP.run('Housekeeping',m,'facility'); insP.run('Catering / Dietary',m,'facility'); }
    for (const m of ['facility_ops','census','clinical','casemgmt','peer','compliance','scheduling','tasks','reports']) { insP.run('Housing Director',m,'facility'); insP.run('House Manager',m,'facility'); }
    for (const m of ['peer','casemgmt','tasks']) insP.run('Recovery Coach',m,'facility');
    for (const m of ['facility_ops','finance','documents','tasks','compliance']) insP.run('Executive Assistant',m,'corporate');
    for (const m of ['hr','documents','compliance','tasks','reports']) insP.run('HR',m,'corporate');
    db.prepare(`INSERT OR REPLACE INTO app_state (key,value) VALUES ('org_foundation_v1', datetime('now'))`).run();
    console.log('[bhos] foundation seeded: 9 facilities, departments, access map, permission matrix; facility_id backfilled to Armada Detox of Akron');
  }
} catch (e) { console.error('[bhos] foundation seed:', e.message); }

// ── Authorization / UR register (Revenue OS) — the first Operational Intelligence
// screen. Tracks every payor authorization: level, approved days, expiration.
// patient_label stays initials-only so the register is safe on corporate-scope
// screens (Guard the Vault); the client link carries the full chart when allowed.
db.exec(`CREATE TABLE IF NOT EXISTS authorizations (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  patient_label TEXT,                       -- initials / short label for display
  facility_id INTEGER REFERENCES org_facilities(id),
  payor TEXT,
  auth_number TEXT,
  level_of_care TEXT,                       -- DTX | RES | PHP | IOP | OP
  approved_days INTEGER,
  start_date TEXT,
  end_date TEXT,                            -- when the authorization runs out
  status TEXT NOT NULL DEFAULT 'active',    -- active | renewed | denied | expired | closed
  reviewer TEXT,                            -- UR contact / reviewer on the payor side
  next_review TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_end ON authorizations(end_date);`);

// ── Billing Readiness (Revenue OS) — one row per active client per day: did the
// chart get at least one QUALIFYING encounter documented in Kipu? Kipu stays the
// EMR of record (read-only); alert workflow + staff notes live here. A day with
// no row or a sync failure is NEVER shown as complete (fail-visible, not silent).
db.exec(`CREATE TABLE IF NOT EXISTS billing_ready_status (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  facility_id INTEGER REFERENCES org_facilities(id),
  status TEXT NOT NULL DEFAULT 'missing',   -- complete | missing | needs_review | exception | sync_error
  encounter_type TEXT,                      -- Group | Individual | Case Management | Nursing | Other
  encounter_title TEXT,                     -- the Kipu note type that qualified
  encounter_time TEXT,
  encounter_staff TEXT,
  alert_state TEXT,                         -- null | open | ack | in_progress | resolved | exception
  exception_reason TEXT,
  detail TEXT,                              -- why needs_review / sync_error (human line)
  checked_at TEXT,
  UNIQUE(date, client_id)
);
CREATE INDEX IF NOT EXISTS idx_bready_date ON billing_ready_status(date);
CREATE TABLE IF NOT EXISTS billing_ready_notes (
  id INTEGER PRIMARY KEY,
  status_id INTEGER NOT NULL REFERENCES billing_ready_status(id) ON DELETE CASCADE,
  by_name TEXT,
  note TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS billing_ready_runs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  by_name TEXT,                             -- who triggered (or 'scheduler')
  active_n INTEGER, complete_n INTEGER, missing_n INTEGER, review_n INTEGER, error_n INTEGER,
  note TEXT
);`);

// ── Scheduling & Service Promise (Excellence Wins) — appointments with a spoken
// commitment attached, and the sub-minute documentation that must exist before a
// meeting can be closed. The concierge `requests` table stays the walk-up queue
// (promise columns added below); this is the planned-care calendar on top of it.
db.exec(`CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  facility_id INTEGER REFERENCES org_facilities(id),
  staff_id INTEGER REFERENCES users(id),
  staff_name TEXT,
  kind TEXT NOT NULL DEFAULT 'Case Management',   -- Case Management | Therapy | Peer Support | Medical | Family | Other
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'scheduled',       -- scheduled | checked_in | in_session | completed | missed | cancelled
  source TEXT DEFAULT 'staff',                    -- staff | kiosk | reschedule
  promise_note TEXT,                              -- the commitment as told to the client
  reschedule_of INTEGER REFERENCES appointments(id),
  missed_reason TEXT,
  note_id INTEGER,                                -- quick_notes.id — documentation proof
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appts_date ON appointments(date);
CREATE TABLE IF NOT EXISTS quick_notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  request_id INTEGER REFERENCES requests(id),
  by_id INTEGER REFERENCES users(id),
  by_name TEXT,
  kind TEXT,
  topics TEXT,                                    -- comma list from the chip picker
  disposition TEXT,                               -- stable | improving | struggling | crisis
  body TEXT,
  needs_expansion INTEGER NOT NULL DEFAULT 0,     -- "expand into a full note later"
  expanded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// ── Staff availability for scheduling: weekly working hours + committed blocks
// (the groups they run, standing meetings). Booking an appointment checks BOTH —
// you cannot promise a client someone who is off, or mid-group.
db.exec(`CREATE TABLE IF NOT EXISTS staff_hours (
  id INTEGER PRIMARY KEY,
  staff_name TEXT NOT NULL,
  dow INTEGER NOT NULL,              -- 0=Sun … 6=Sat
  start_time TEXT NOT NULL,          -- HH:MM
  end_time TEXT NOT NULL,
  UNIQUE(staff_name, dow, start_time)
);
CREATE TABLE IF NOT EXISTS staff_blocks (
  id INTEGER PRIMARY KEY,
  staff_name TEXT NOT NULL,
  dow INTEGER,                       -- weekly recurring (null when one-off)
  date TEXT,                         -- one-off date (null when weekly)
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  label TEXT                         -- e.g. "Men's Process Group"
);`);

// ── The owner's Desk — one capture inbox for everything he's working on.
// Items arrive from the app, a text (Twilio webhook), or an iPhone shortcut;
// dates parse out of the sentence; "waiting on" items nudge the person through
// their Today inbox. ADHD-first: the system does the remembering.
db.exec(`CREATE TABLE IF NOT EXISTS desk_items (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  detail TEXT,
  kind TEXT NOT NULL DEFAULT 'task',          -- task | followup | idea | appt
  with_who TEXT,                              -- who has to help close it
  with_user_id INTEGER REFERENCES users(id),  -- matched staff → lands in their Today
  due_date TEXT,
  due_time TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- open | waiting | done
  priority TEXT DEFAULT 'Normal',
  source TEXT DEFAULT 'app',                  -- app | sms | shortcut
  snooze_until TEXT,
  nudged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_desk_owner ON desk_items(owner_id, status);`);

// Insurance brokers / agents — who to call per policy.
db.exec(`CREATE TABLE IF NOT EXISTS insurance_brokers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  agency TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Insurance policies across every entity. Renewal reminders fire off expiration_date;
// the coverage matrix flags any entity missing a required coverage so nothing lapses
// and every entity carries full coverage. `reminded` tracks which day-thresholds have
// already been emailed so reminders don't repeat.
db.exec(`CREATE TABLE IF NOT EXISTS insurance_policies (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,                         -- which location / legal entity
  coverage_type TEXT NOT NULL,                  -- General Liability | Professional Liability | Property | ...
  carrier TEXT,                                 -- insurance company
  policy_number TEXT,
  broker_id INTEGER REFERENCES insurance_brokers(id),
  broker_name TEXT,                             -- denormalized for display / if no broker row
  effective_date TEXT,
  expiration_date TEXT,                          -- the renewal date reminders fire off
  premium REAL,                                 -- annual premium
  limit_each TEXT,                              -- per-occurrence limit
  limit_aggregate TEXT,
  deductible TEXT,
  status TEXT NOT NULL DEFAULT 'active',         -- active | pending | expired | cancelled
  auto_renew INTEGER NOT NULL DEFAULT 0,
  doc_url TEXT,                                  -- link to the policy copy (Drive/OneDrive)
  notes TEXT,
  reminded TEXT,                                -- JSON array of thresholds already emailed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ins_entity ON insurance_policies(entity, coverage_type);
CREATE INDEX IF NOT EXISTS idx_ins_exp ON insurance_policies(expiration_date);`);
// Org-wide employee roster (HR / ownership) across all entities, broken down by
// location. Salary is highly sensitive — the endpoints are admin-only. Seeded from the
// Active Employees export; job title + salary are filled in by the owner.
db.exec(`CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,                        -- location / legal entity
  last_name TEXT,
  first_name TEXT,
  job_title TEXT,
  salary REAL,
  pay_type TEXT NOT NULL DEFAULT 'annual',     -- annual | hourly
  status TEXT NOT NULL DEFAULT 'active',        -- active | inactive
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_entity ON hr_employees(entity, last_name);`);
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
// Kipu/Salesforce timestamps are UTC. A real-time UTC instant (e.g. an evening-ET
// admit at 9pm = 1am UTC the next day) must be read as the EASTERN calendar day, or
// it lands on "tomorrow". But a bare date ("2026-06-26") or a midnight marker
// ("…T00:00:00") is just a date — trust it as-is so we never shift a correct day.
export function localDateOf(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!m) return s.slice(0, 10) || null;
  if (m[2] == null || (m[2] === '00' && m[3] === '00')) return m[1];   // bare date / midnight marker
  const d = new Date(s);
  return isNaN(d.getTime()) ? m[1] : appToday(d);                      // real instant → Eastern day
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
addColumn('clients', 'merged_into', 'INTEGER');     // set when this row was merged into another (de-dupe); kept for reversibility
// OUTPATIENT — a separate Kipu location (e.g. Akron House Recovery), owner-only.
// Read-only snapshot of the current census, classified by level of care. Kept apart
// from the detox `clients` table entirely.
db.exec(`CREATE TABLE IF NOT EXISTS outpatient_clients (
  kipu_id TEXT PRIMARY KEY,
  name TEXT, pref TEXT, level TEXT, loc_class TEXT,
  admit TEXT, mrn TEXT, therapist TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// History tracking so we can measure PHP→IOP movement, LOS per level, and trends.
addColumn('outpatient_clients', 'payer', 'TEXT');          // insurance / payer
addColumn('outpatient_clients', 'php_start', 'TEXT');      // PHP start (≈ admit; everyone admits at PHP)
addColumn('outpatient_clients', 'iop_start', 'TEXT');      // date we first saw them move to IOP
addColumn('outpatient_clients', 'first_seen', 'TEXT');     // first refresh we saw them
addColumn('outpatient_clients', 'last_seen', 'TEXT');      // most recent refresh we saw them
addColumn('outpatient_clients', 'discharged_at', 'TEXT');  // date they dropped off the census
addColumn('outpatient_clients', 'discharge_loc', 'TEXT');  // level they were at when they left
addColumn('outpatient_clients', 'active', 'INTEGER');      // 1 = currently on census
// Audit trail for duplicate-client merges — a JSON snapshot of each retired row so a
// merge can be reviewed or reversed.
db.exec(`CREATE TABLE IF NOT EXISTS client_merges (
  id INTEGER PRIMARY KEY,
  kept_id INTEGER, dupe_id INTEGER,
  snapshot TEXT, by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

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

// ── org_events: the platform event spine (Constitution, Article II) ───────────
// One row per business moment (admission.created, order.requested, ...). It is
// three things at once: the activity feed, the audit trail of what-happened-when,
// and usage telemetry (Principle 15). Modules publish; anything may read.
// `summary` is the human line shown in feeds — for patient events use initials,
// never full names, so corporate-scope screens stay PHI-light (Principle 13).
db.exec(`CREATE TABLE IF NOT EXISTS org_events (
  id INTEGER PRIMARY KEY,
  event TEXT NOT NULL,              -- dot-namespaced: admission.created, order.placed, ...
  entity TEXT,                      -- entity type: client|order|incident|employee|leave|maintenance|...
  entity_id TEXT,
  facility_id INTEGER REFERENCES org_facilities(id),
  actor TEXT,                       -- username, or 'system'/'kipu' for automation
  summary TEXT,                     -- one human-readable line for the activity feed
  payload TEXT,                     -- JSON detail (optional)
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_events_at ON org_events(at);
CREATE INDEX IF NOT EXISTS idx_org_events_event ON org_events(event);`);

// Publishing must never break the workflow that publishes — swallow everything.
export function publishEvent({ event, entity = null, entity_id = null, facility_id = null, actor = null, summary = null, payload = null }) {
  try {
    db.prepare(`INSERT INTO org_events (event, entity, entity_id, facility_id, actor, summary, payload) VALUES (?,?,?,?,?,?,?)`)
      .run(event, entity, entity_id != null ? String(entity_id) : null, facility_id, actor, summary, payload ? JSON.stringify(payload) : null);
  } catch { /* the event spine never takes a workflow down with it */ }
}
// Patient names shrink to initials before they touch a feed (Principle 13).
export function nameInitials(n) {
  return String(n || '').trim().split(/\s+/).map((w) => (w[0] || '').toUpperCase()).join('') || '?';
}
// The default facility for operational writes (Armada Detox of Akron) — every new
// row that doesn't say otherwise belongs to detox, so per-facility scoping stays
// truthful as other facilities come online. Cached after first lookup.
let _defFacId;
export function defaultFacilityId() {
  if (_defFacId !== undefined) return _defFacId;
  try { _defFacId = db.prepare(`SELECT id FROM org_facilities WHERE fkey='detox-akron'`).get()?.id ?? null; }
  catch { _defFacId = null; }
  return _defFacId;
}

export default db;

// ── Late-table column additions ────────────────────────────────────────────────
// These tables are created above (corp/HCOS sections), AFTER the main addColumn
// block — so their column migrations must run here, at the end of the schema, or a
// brand-new database crashes on first boot ('no such table').
addColumn('leases', 'landlord_email', 'TEXT');            // where landlord-responsibility emails go
addColumn('leases', 'landlord_categories', 'TEXT');      // comma list of categories the landlord covers
addColumn('order_requests', 'landlord_emailed', 'TEXT'); // when we auto-emailed the landlord (dedupe)
addColumn('entity_records', 'status', 'TEXT');           // active | closed (archive)
addColumn('leases', 'file_id', 'INTEGER');               // uploaded lease file (corp_files)
addColumn('insurance_policies', 'file_id', 'INTEGER');   // uploaded policy file (corp_files)
addColumn('hr_employees', 'hire_date', 'TEXT');          // drives onboarding + review scheduling
addColumn('hr_employees', 'email', 'TEXT');
addColumn('hr_employees', 'phone', 'TEXT');
addColumn('hr_employees', 'department', 'TEXT');
addColumn('hr_employees', 'manager', 'TEXT');
addColumn('hr_employees', 'birthday', 'TEXT');           // MM-DD or YYYY-MM-DD — celebrations
addColumn('hr_employees', 'term_date', 'TEXT');          // offboarding: last day
addColumn('hr_employees', 'term_reason', 'TEXT');        // Resignation | Retirement | Layoff | Termination
addColumn('hr_onboard_tasks', 'phase', 'TEXT');          // null/'onboard' | 'offboard'
addColumn('authorizations', 'reminded', 'TEXT');         // JSON of reminder thresholds already sent
addColumn('requests', 'promise_at', 'TEXT');             // Service Promise: committed response time
addColumn('requests', 'promised_by', 'TEXT');
addColumn('requests', 'claimed_by', 'TEXT');             // who picked it up (response-time metric)
addColumn('requests', 'claimed_at', 'TEXT');
addColumn('requests', 'ready_at', 'TEXT');               // staff ready — kiosk flashes "you're up"
// One-FINAL-time ownership repair (Rebuild Blueprint, Phase 1): legacy rows that
// arrived without a facility belong to detox. This used to run on EVERY boot,
// which meant any future facility's unstamped row would be silently re-owned by
// Akron — so it now runs once and latches. After this, unstamped rows are a
// visible defect to surface, never a silent reassignment.
try {
  if (getState('facility_null_repair_final') !== 'done') {
    const dfid = db.prepare(`SELECT id FROM org_facilities WHERE fkey='detox-akron'`).get()?.id;
    if (dfid) {
      for (const t of ['clients', 'expected_arrivals', 'incidents', 'admissions']) {
        try { db.prepare(`UPDATE ${t} SET facility_id=? WHERE facility_id IS NULL`).run(dfid); } catch { /* table optional */ }
      }
      setState('facility_null_repair_final', 'done');
    }
  }
} catch { /* registry not seeded yet (fresh boot order) — next boot latches */ }
addColumn('order_requests', 'tracking', 'TEXT');         // carrier tracking # or URL (shown on the status page)
addColumn('desk_items', 'bucket', 'TEXT');               // AI-filed: Clinical/Maintenance/Expansion/…
addColumn('desk_items', 'facility_id', 'INTEGER');       // AI-matched location (owner chain, Principle 3)
addColumn('desk_items', 'suggested_role', 'TEXT');       // AI: which role should help close this

// ── Excellence OS: the handbook lives in the daily work, not on a shelf ────────
// Recognition names the standard it reflects; coaching points at the written line;
// Fridays close with a four-question reflection. (Improvement ideas already live
// in staff_voice / Best Place to Work — one system, not two.)
addColumn('extra_mile', 'principle', 'TEXT');            // which Armada Principle the recognition reflects
addColumn('hr_coaching', 'standard', 'TEXT');            // the written standard the coaching is from ("no random criticism")
addColumn('hr_coaching', 'follow_up', 'TEXT');           // date the coach committed to circle back
addColumn('hr_coaching', 'followed_up_at', 'TEXT');      // when the follow-up actually happened
db.exec(`
CREATE TABLE IF NOT EXISTS weekly_reflections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id), user_name TEXT,
  week TEXT NOT NULL,                       -- the Monday of the week (one per person per week)
  proud TEXT, barrier TEXT, lived TEXT, improve TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, week)
);
-- Phase 2 (Measurement): the monthly Excellence Survey. Answers are stored WITHOUT
-- the person's name (role only, for slicing) — the done-marker lives in a separate
-- table so we can prompt/dedupe without ever being able to join a person to answers.
CREATE TABLE IF NOT EXISTS excellence_surveys (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,                      -- 'YYYY-MM'
  role TEXT,                                -- job role only — never the name
  q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER, q5 INTEGER, q6 INTEGER,  -- 1-5 agree
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS excellence_survey_done (
  user_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
);`);
// One-time: the two Excellence questions the client experience survey was missing
// ("did someone keep their promises" / "did staff work together") — the handbook's
// client-side measures, asked in the clients' own survey.
if (getState('exp_survey_excellence_v1') !== 'done') {
  const sid = db.prepare(`SELECT id FROM surveys WHERE key = 'experience'`).get()?.id;
  if (sid) {
    const ins = db.prepare(`INSERT INTO survey_questions (survey_id, category, text, type, sort) VALUES (?,?,?,?,?)`);
    ins.run(sid, 'Excellence', 'People here keep their promises — if they said they would do something, they did it.', 'scale', 98);
    ins.run(sid, 'Excellence', 'The staff work together as one team around my care.', 'scale', 99);
    setState('exp_survey_excellence_v1', 'done');
  }
}

// ── REBUILD PHASE 1 — Foundation integrity (docs/ARMADA-REBUILD-BLUEPRINT.md) ──
// All additive, idempotent, state-latched. Empty DB and yesterday's DB both boot.

// 1a. growth_checkins was CREATE'd twice with incompatible shapes; the first
// (staff_id/goal/note) wins on any real DB, so the second family of endpoints
// (user_id/progress/support/self) threw 'no such column'. Give the winning
// table the missing columns so BOTH endpoint families work everywhere.
addColumn('growth_checkins', 'user_id', 'INTEGER');
addColumn('growth_checkins', 'progress', 'TEXT');
addColumn('growth_checkins', 'support', 'TEXT');
addColumn('growth_checkins', 'self', 'TEXT');

// 1b. The registry gains what the rebuild needs: a facility keeps its own clock
// (Wheatfield IN is Central time), its service list, and its module set.
addColumn('org_facilities', 'timezone', 'TEXT');   // IANA tz; falls back to APP_TZ
addColumn('org_facilities', 'services', 'TEXT');   // JSON array, e.g. ["detox","residential"]
addColumn('org_facilities', 'modules', 'TEXT');    // JSON array; defaulted by type when blank

// 1c. Registry corrections + the two missing Greenwood facilities (owner, 2026-07-03):
// Wheatfield offers the same services as Akron detox (type detox, not outpatient);
// "Akron House" is what the owner calls Armada Clinical; Spark/Reverie Greenwood
// exist in the real world but not in the registry.
if (getState('org_registry_v2') !== 'done') {
  try {
    db.prepare(`UPDATE org_facilities SET type='detox', services=COALESCE(services,'["detox","residential"]') WHERE fkey='wheatfield'`).run();
    const old = db.prepare(`SELECT name, entity_aliases FROM org_facilities WHERE fkey='akron-house'`).get();
    if (old && !/clinical/i.test(old.name || '')) {
      let aliases = []; try { aliases = JSON.parse(old.entity_aliases || '[]'); } catch { /* fresh */ }
      if (!aliases.includes(old.name)) aliases.push(old.name);
      db.prepare(`UPDATE org_facilities SET name='Armada Clinical of Akron', entity_aliases=? WHERE fkey='akron-house'`).run(JSON.stringify(aliases));
    }
    const insF = db.prepare(`INSERT INTO org_facilities (fkey, name, brand, region, type, kipu_location_name, entity_aliases, active, sort)
      SELECT ?,?,?,?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM org_facilities WHERE fkey=?)`);
    insF.run('spark-greenwood', 'Spark Recovery of Greenwood', 'Spark', 'Indiana', 'outpatient', 'Greenwood', '["Spark Recovery of Greenwood"]', 60, 'spark-greenwood');
    insF.run('reverie-greenwood', 'Reverie Sober Living of Greenwood', 'Reverie', 'Indiana', 'sober-living', '', '["Reverie Sober Living of Greenwood"]', 61, 'reverie-greenwood');
    // Timezones: Wheatfield IN sits in Central time; everything else Eastern.
    db.prepare(`UPDATE org_facilities SET timezone='America/Chicago' WHERE fkey='wheatfield' AND (timezone IS NULL OR timezone='')`).run();
    db.prepare(`UPDATE org_facilities SET timezone='America/New_York' WHERE timezone IS NULL OR timezone=''`).run();
    setState('org_registry_v2', 'done');
  } catch (e) { console.error('[registry v2]', e.message); }
}

// 1d. facility_id was un-indexed everywhere (Gate 5: a query scoped by
// facility_id must scale). Idempotent; skips tables that don't exist yet.
for (const t of ['clients', 'shifts', 'inventory_items', 'incidents', 'expected_arrivals', 'admissions', 'desk_items', 'appointments', 'authorizations', 'billing_ready_status', 'org_events', 'user_facility_access']) {
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_facility ON ${t}(facility_id)`); } catch { /* table optional */ }
}

// 1e. The demo client ("Sample Client 12A") was seeded ACTIVE into the census —
// retire it once (reversible; the row is kept, just no longer counted in care).
if (getState('demo_client_retired') !== 'done') {
  try {
    db.prepare(`UPDATE clients SET active=0, discharge_status='Administrative', discharge_date=COALESCE(discharge_date, date('now')) WHERE name='Sample Client 12A' AND source IS NULL`).run();
    setState('demo_client_retired', 'done');
  } catch { /* clients table optional on exotic boots */ }
}

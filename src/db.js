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
`);

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

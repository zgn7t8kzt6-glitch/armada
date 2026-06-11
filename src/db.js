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
  created_by INTEGER REFERENCES users(id),
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
`);

export function audit({ user, action, entity = null, entity_id = null, detail = null, ip = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(user?.id ?? null, user?.username ?? null, action, entity, entity_id, detail, ip);
}

export default db;

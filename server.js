// Armada Care Standards — multi-user server
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, audit, getState, setState } from './src/db.js';
import { buildWeeklyData, renderReportHtml, sendWeeklyReport, emailConfigured, surveyMetrics } from './src/report.js';
import {
  cookies, login, logout, currentUser, requireAuth, requireAdmin, createUser,
} from './src/auth.js';
import { ensureAdmin, ensureSampleData } from './src/seed.js';
import { generateShiftTasks, generateAmaRead, generateCareBrief, generateShiftBriefing, claudeConfigured, AMA_TRIGGERS } from './src/claude.js';

// On boot, make sure there's an admin to log in with (reads ADMIN_USER / ADMIN_PASS).
// Optionally load demo data when SEED_SAMPLE=true (handy for a pilot).
ensureAdmin();
if (process.env.SEED_SAMPLE === 'true') ensureSampleData();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookies);

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const SHIFTS = ['Morning', 'Day', 'Evening', 'Night'];
const JOB_ROLES = ['BHT / Tech', 'Nurse', 'Therapist', 'Kitchen'];
const DEPARTMENTS = ['Front Desk / Concierge', 'Clinical / Therapy', 'Nursing / Medical', 'Kitchen / Dietary', 'Housekeeping', 'Maintenance', 'Transportation', 'Activities / Recreation', 'Family Services', 'Spiritual Care'];
const SCHEDULE_TYPES = ['Group', 'Activity', 'Meal', 'Outing', 'Appointment', 'Wellness'];

/* ---------------- auth ---------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = login(req, res, username || '', password || '');
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ user });
});

app.post('/api/logout', (req, res) => { logout(req, res); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user || null });
});

/* ---------------- clients (care cards) ---------------- */
app.get('/api/clients', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM clients WHERE active = 1 ORDER BY name`).all();
  for (const c of rows) c.tasks = db.prepare(`SELECT * FROM tasks WHERE client_id = ? ORDER BY sort, id`).all(c.id);
  res.json({ clients: rows });
});

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.tasks = db.prepare(`SELECT * FROM tasks WHERE client_id = ? ORDER BY sort, id`).all(c.id);
  audit({ user: req.user, action: 'VIEW', entity: 'client', entity_id: c.id, detail: c.name, ip: req.ip });
  res.json({ client: c });
});

const CLIENT_FIELDS = ['name', 'pref', 'room', 'program', 'admit', 'sober', 'touch', 'prefs', 'goals', 'triggers', 'safety', 'support', 'welcome_plan', 'aftercare_plan', 'allergies', 'medications'];

function saveTasks(clientId, tasks = []) {
  db.prepare(`DELETE FROM tasks WHERE client_id = ?`).run(clientId);
  const ins = db.prepare(`INSERT INTO tasks (client_id, shift, job_role, text, priority, sort) VALUES (?, ?, ?, ?, ?, ?)`);
  tasks.forEach((t, i) => {
    if (!t.text?.trim()) return;
    ins.run(clientId, SHIFTS.includes(t.shift) ? t.shift : 'Morning',
      t.job_role || 'All', t.text.trim(), t.priority === 'High' ? 'High' : 'Normal', i);
  });
}

app.post('/api/clients', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim() && !b.pref?.trim()) return res.status(400).json({ error: 'Name required' });
  const vals = CLIENT_FIELDS.map(f => b[f] ?? null);
  const info = db.prepare(
    `INSERT INTO clients (${CLIENT_FIELDS.join(',')}) VALUES (${CLIENT_FIELDS.map(() => '?').join(',')})`
  ).run(...vals);
  saveTasks(info.lastInsertRowid, b.tasks);
  audit({ user: req.user, action: 'CREATE', entity: 'client', entity_id: info.lastInsertRowid, detail: b.name, ip: req.ip });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const b = req.body || {};
  const exists = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    `UPDATE clients SET ${CLIENT_FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).run(...CLIENT_FIELDS.map(f => b[f] ?? null), req.params.id);
  saveTasks(req.params.id, b.tasks);
  audit({ user: req.user, action: 'UPDATE', entity: 'client', entity_id: +req.params.id, detail: b.name, ip: req.ip });
  res.json({ ok: true });
});

app.delete('/api/clients/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare(`UPDATE clients SET active = 0 WHERE id = ?`).run(req.params.id);
  audit({ user: req.user, action: 'DELETE', entity: 'client', entity_id: +req.params.id, ip: req.ip });
  res.json({ ok: true });
});

/* ---------------- Claude: draft shift tasks from a Care Card ---------------- */
// Takes the (possibly unsaved) Care Card fields, returns suggested tasks for the
// user to review/edit before saving. Does not persist anything.
app.post('/api/suggest-tasks', requireAuth, async (req, res) => {
  if (!claudeConfigured()) {
    return res.status(503).json({ error: 'Claude is not configured. Set ANTHROPIC_API_KEY to enable AI suggestions.' });
  }
  const b = req.body || {};
  const hasContent = ['pref', 'name', 'touch', 'prefs', 'goals', 'triggers', 'safety', 'program', 'support']
    .some((f) => b[f] && b[f].trim());
  if (!hasContent) return res.status(400).json({ error: 'Add some Care Card details first.' });
  try {
    const tasks = await generateShiftTasks(b);
    audit({ user: req.user, action: 'AI_SUGGEST', entity: 'client', detail: b.name || b.pref, ip: req.ip });
    res.json({ tasks });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not generate suggestions.' });
  }
});

/* ---------------- Daily Pulse + AMA risk (retention) ---------------- */
// Log a quick per-shift check-in for a client.
app.post('/api/pulses', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: 'Missing client' });
  const date = b.date || new Date().toISOString().slice(0, 10);
  const shift = SHIFTS.includes(b.shift) ? b.shift : 'Morning';
  const triggers = Array.isArray(b.triggers) ? JSON.stringify(b.triggers) : '[]';
  db.prepare(
    `INSERT INTO pulses (client_id, date, shift, concern, engagement, triggers, statements, note, author_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(b.client_id, date, shift, b.concern || 'Low', b.engagement || null, triggers,
    b.statements || null, b.note || null, req.user.id);
  audit({ user: req.user, action: 'PULSE', entity: 'client', entity_id: +b.client_id, ip: req.ip });

  // Auto-generate the recap + action plan when concern is High.
  let autoPlan = false;
  if (b.concern === 'High' && claudeConfigured()) {
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(b.client_id);
    if (client) {
      try { await runAndStoreAmaRead(client, req.user, req.ip); autoPlan = true; } catch (e) { /* don't fail the pulse */ }
    }
  }
  res.json({ ok: true, autoPlan });
});

function recentPulses(clientId, limit = 8) {
  return db.prepare(`SELECT * FROM pulses WHERE client_id = ? ORDER BY id DESC LIMIT ?`)
    .all(clientId, limit)
    .map((p) => ({ ...p, triggers: safeArr(p.triggers) }));
}
function safeArr(s) { try { return JSON.parse(s) || []; } catch (e) { return []; } }

function latestAmaRead(clientId) {
  const r = db.prepare(`SELECT * FROM ama_reads WHERE client_id = ? ORDER BY id DESC LIMIT 1`).get(clientId);
  if (!r) return null;
  return { ...r, triggers: safeArr(r.triggers), actions: safeArr(r.actions), cared_for: safeArr(r.cared_for) };
}

// Gather context, ask Claude, store the read. Reused by the button and by
// auto-generation when a High-concern pulse is logged.
async function runAndStoreAmaRead(client, user, ip) {
  const pulses = recentPulses(client.id);
  const handoffs = db.prepare(`SELECT note FROM handoffs WHERE client_id = ? ORDER BY id DESC LIMIT 6`).all(client.id);
  const read = await generateAmaRead(client, pulses, handoffs);
  db.prepare(
    `INSERT INTO ama_reads (client_id, level, summary, triggers, actions, approach, underlying, cared_for, best_play, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(client.id, read.level, read.summary, JSON.stringify(read.triggers),
    JSON.stringify(read.actions), read.approach, read.underlying || null,
    JSON.stringify(read.cared_for || []), read.best_play || null, user.id);
  audit({ user, action: 'AMA_READ', entity: 'client', entity_id: client.id, detail: read.level, ip });
  return read;
}

// Run Claude's AMA recap + action plan for a client and store it.
app.post('/api/clients/:id/ama-read', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured (set ANTHROPIC_API_KEY).' });
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  try {
    const read = await runAndStoreAmaRead(client, req.user, req.ip);
    res.json({ read });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not assess.' });
  }
});

// Apply the latest plan's tasks (and feel-cared-for gestures) to the Care Card.
app.post('/api/clients/:id/plan-to-tasks', requireAuth, (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const read = latestAmaRead(client.id);
  if (!read) return res.status(400).json({ error: 'No plan to apply yet.' });
  const defShift = SHIFTS.includes(req.body?.shift) ? req.body.shift : 'Morning';
  const existing = new Set(db.prepare(`SELECT text FROM tasks WHERE client_id = ?`).all(client.id).map((t) => t.text));
  const ins = db.prepare(`INSERT INTO tasks (client_id, shift, job_role, text, priority, sort) VALUES (?, ?, ?, ?, ?, ?)`);
  let n = 0, sort = 1000;
  for (const a of read.actions || []) {
    if (!a.text || existing.has(a.text)) continue;
    ins.run(client.id, SHIFTS.includes(a.shift) ? a.shift : defShift, a.job_role || 'All', a.text, a.priority === 'High' ? 'High' : 'Normal', sort++);
    existing.add(a.text); n++;
  }
  for (const g of read.cared_for || []) {
    if (!g || existing.has(g)) continue;
    ins.run(client.id, defShift, 'BHT / Tech', g, 'Normal', sort++);
    existing.add(g); n++;
  }
  audit({ user: req.user, action: 'PLAN_APPLY', entity: 'client', entity_id: client.id, detail: `${n} tasks`, ip: req.ip });
  res.json({ added: n });
});

// Retention dashboard: every client's current risk, pulse status, and which
// warning signs are trending across the center.
app.get('/api/retention', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const clients = db.prepare(`SELECT id, name, pref, room, program, admit FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const out = clients.map((c) => {
    const ama = latestAmaRead(c.id);
    const lastPulse = db.prepare(`SELECT date, shift, concern FROM pulses WHERE client_id = ? ORDER BY id DESC LIMIT 1`).get(c.id);
    const pulsedToday = !!db.prepare(`SELECT 1 FROM pulses WHERE client_id = ? AND date = ? LIMIT 1`).get(c.id, today);
    return {
      id: c.id, name: c.name, pref: c.pref, room: c.room, program: c.program, admit: c.admit,
      level: ama ? ama.level : null,
      summary: ama ? ama.summary : null,
      lastReadAt: ama ? ama.created_at : null,
      lastPulse: lastPulse || null,
      pulsedToday,
    };
  });
  const rank = { High: 3, Elevated: 2, Low: 1 };
  out.sort((a, b) => (rank[b.level] || 0) - (rank[a.level] || 0) || (a.room || '').localeCompare(b.room || ''));

  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const recent = db.prepare(`SELECT triggers FROM pulses WHERE date >= ?`).all(since);
  const counts = {};
  recent.forEach((r) => safeArr(r.triggers).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const triggerCounts = Object.entries(counts).map(([trigger, count]) => ({ trigger, count })).sort((a, b) => b.count - a.count);

  const summary = {
    high: out.filter((c) => c.level === 'High').length,
    elevated: out.filter((c) => c.level === 'Elevated').length,
    notPulsedToday: out.filter((c) => !c.pulsedToday).length,
    total: out.length,
    pulsesToday: db.prepare(`SELECT COUNT(*) n FROM pulses WHERE date = ?`).get(today).n,
  };
  res.json({ clients: out, triggerCounts, summary, windowDays: 14 });
});

/* ---------------- shifts / assignments / completions ---------------- */
function getOrCreateShift(date, name) {
  let s = db.prepare(`SELECT * FROM shifts WHERE date = ? AND name = ?`).get(date, name);
  if (!s) {
    const info = db.prepare(`INSERT INTO shifts (date, name) VALUES (?, ?)`).run(date, name);
    s = { id: info.lastInsertRowid, date, name };
  }
  return s;
}

// The Shift Playbook: clients + the tasks for this shift/role, with completion state
app.get('/api/playbook', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const name = SHIFTS.includes(req.query.shift) ? req.query.shift : 'Morning';
  const role = req.query.role || 'All';
  const shift = getOrCreateShift(date, name);

  const assignees = db.prepare(
    `SELECT u.id, u.name, u.job_role FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.shift_id = ?`
  ).all(shift.id);

  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const done = new Set(db.prepare(`SELECT task_id FROM completions WHERE shift_id = ?`).all(shift.id).map(r => r.task_id));
  const handoffs = db.prepare(`SELECT * FROM handoffs WHERE shift_id = ? ORDER BY created_at`).all(shift.id);

  const out = [];
  for (const c of clients) {
    const tasks = db.prepare(
      `SELECT * FROM tasks WHERE client_id = ? AND shift = ? AND (job_role = 'All' OR ? = 'All' OR job_role = ?)
       ORDER BY (priority='High') DESC, sort`
    ).all(c.id, name, role, role);
    if (!tasks.length && !c.safety && !c.touch) continue;
    const pulsedThisShift = db.prepare(
      `SELECT 1 FROM pulses WHERE client_id = ? AND date = ? AND shift = ? LIMIT 1`
    ).get(c.id, date, name);
    out.push({
      ...c,
      tasks: tasks.map(t => ({ ...t, done: done.has(t.id) })),
      handoffs: handoffs.filter(h => h.client_id === c.id),
      ama: latestAmaRead(c.id),
      pulsedThisShift: !!pulsedThisShift,
    });
  }
  res.json({ shift, assignees, clients: out, role });
});

app.post('/api/completions', requireAuth, (req, res) => {
  const { date, shift, task_id, done } = req.body || {};
  const s = getOrCreateShift(date, shift);
  if (done) {
    db.prepare(`INSERT OR IGNORE INTO completions (shift_id, task_id, done_by) VALUES (?, ?, ?)`)
      .run(s.id, task_id, req.user.id);
  } else {
    db.prepare(`DELETE FROM completions WHERE shift_id = ? AND task_id = ?`).run(s.id, task_id);
  }
  res.json({ ok: true });
});

app.post('/api/handoffs', requireAuth, (req, res) => {
  const { date, shift, client_id, note } = req.body || {};
  if (!note?.trim()) return res.status(400).json({ error: 'Empty note' });
  const s = getOrCreateShift(date, shift);
  db.prepare(`INSERT INTO handoffs (shift_id, client_id, note, author_id) VALUES (?, ?, ?, ?)`)
    .run(s.id, client_id, note.trim(), req.user.id);
  audit({ user: req.user, action: 'CREATE', entity: 'handoff', entity_id: client_id, ip: req.ip });
  res.json({ ok: true });
});

// Assign staff to a shift (admin)
app.get('/api/assignments', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const name = SHIFTS.includes(req.query.shift) ? req.query.shift : 'Morning';
  const s = getOrCreateShift(date, name);
  const assigned = db.prepare(`SELECT user_id FROM assignments WHERE shift_id = ?`).all(s.id).map(r => r.user_id);
  const staff = db.prepare(`SELECT id, name, job_role FROM users WHERE active = 1 ORDER BY name`).all();
  res.json({ assigned, staff });
});

app.post('/api/assignments', requireAuth, requireAdmin, (req, res) => {
  const { date, shift, user_ids = [] } = req.body || {};
  const s = getOrCreateShift(date, shift);
  db.prepare(`DELETE FROM assignments WHERE shift_id = ?`).run(s.id);
  const ins = db.prepare(`INSERT OR IGNORE INTO assignments (shift_id, user_id) VALUES (?, ?)`);
  for (const uid of user_ids) ins.run(s.id, uid);
  res.json({ ok: true });
});

/* ---------------- users (admin) ---------------- */
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: db.prepare(`SELECT id, name, username, role, job_role, active FROM users ORDER BY name`).all() });
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, username, password, role, job_role } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const id = createUser({ name, username, password, role: role === 'admin' ? 'admin' : 'staff', job_role });
    audit({ user: req.user, action: 'CREATE', entity: 'user', entity_id: id, detail: username, ip: req.ip });
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

/* ---------------- audit log (admin) ---------------- */
app.get('/api/audit', requireAuth, requireAdmin, (req, res) => {
  res.json({ entries: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 300`).all() });
});

app.get('/api/meta', requireAuth, (req, res) => res.json({ shifts: SHIFTS, jobRoles: JOB_ROLES, claude: claudeConfigured(), amaTriggers: AMA_TRIGGERS, departments: DEPARTMENTS, scheduleTypes: SCHEDULE_TYPES }));

/* ---------------- Ritz modules: farewell, ownership, delight, culture, voice, outcomes ---------------- */

const SERVICE_VALUES = [
  'I build genuine relationships so every client feels they belong here.',
  'I am always responsive to the expressed and unexpressed needs of our clients.',
  'I am empowered to create personal, memorable moments of care.',
  'I understand my role in our mission: helping clients feel cared for and complete recovery.',
  'I continuously look for ways to improve our clients’ experience.',
  'I own and immediately resolve any client problem I hear about.',
  'I create teamwork and lateral service — I help any client and any teammate.',
  'I have the opportunity to keep learning and growing.',
  'I have a voice in the work that affects me.',
  'I carry myself with warmth, professionalism, and respect.',
  'I protect the privacy, dignity, and safety of our clients and teammates.',
  'I keep our environment clean, calm, and safe for healing.',
];

// Discharge a client; auto-create aftercare follow-up calls (the fond farewell).
app.post('/api/clients/:id/discharge', requireAuth, (req, res) => {
  const { status, date } = req.body || {};
  if (!['Completed', 'AMA', 'Transferred'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const d = date || new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE clients SET discharge_status = ?, discharge_date = ? WHERE id = ?`).run(status, d, req.params.id);
  if (status !== 'Transferred') {
    const base = new Date(d + 'T00:00').getTime();
    const ins = db.prepare(`INSERT INTO followups (client_id, type, due_date) VALUES (?, ?, ?)`);
    [[1, '24h'], [2, '48h'], [30, '30d']].forEach(([days, type]) =>
      ins.run(req.params.id, type, new Date(base + days * 864e5).toISOString().slice(0, 10)));
  }
  audit({ user: req.user, action: 'DISCHARGE', entity: 'client', entity_id: +req.params.id, detail: status, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/clients/:id/readmit', requireAuth, (req, res) => {
  db.prepare(`UPDATE clients SET discharge_status = NULL, discharge_date = NULL WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// Aftercare follow-up calls
app.get('/api/followups', requireAuth, (req, res) => {
  res.json({ followups: db.prepare(
    `SELECT f.*, c.pref, c.name FROM followups f JOIN clients c ON c.id = f.client_id
     WHERE f.status = 'Pending' ORDER BY f.due_date`).all() });
});
app.post('/api/followups/:id', requireAuth, (req, res) => {
  const st = ['Done', 'Unreachable', 'Pending'].includes(req.body?.status) ? req.body.status : 'Done';
  db.prepare(`UPDATE followups SET status = ?, note = ?, done_by = ?, done_at = datetime('now') WHERE id = ?`)
    .run(st, req.body?.note || null, req.user.id, req.params.id);
  res.json({ ok: true });
});

// Concerns (lateral ownership)
app.get('/api/concerns', requireAuth, (req, res) => {
  res.json({ concerns: db.prepare(
    `SELECT co.*, c.pref, c.name FROM concerns co JOIN clients c ON c.id = co.client_id
     ORDER BY (co.status = 'Open') DESC, co.id DESC LIMIT 100`).all() });
});
app.post('/api/concerns', requireAuth, (req, res) => {
  const { client_id, text } = req.body || {};
  if (!client_id || !text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO concerns (client_id, text, owner_id, owner_name) VALUES (?, ?, ?, ?)`)
    .run(client_id, text.trim(), req.user.id, req.user.name);
  audit({ user: req.user, action: 'CONCERN', entity: 'client', entity_id: +client_id, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/concerns/:id/resolve', requireAuth, (req, res) => {
  db.prepare(`UPDATE concerns SET status = 'Resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?`)
    .run((req.body?.resolution || '').trim() || null, req.params.id);
  res.json({ ok: true });
});

// Delights ("whatever it takes")
app.get('/api/delights', requireAuth, (req, res) => {
  res.json({ delights: db.prepare(
    `SELECT d.*, c.pref FROM delights d LEFT JOIN clients c ON c.id = d.client_id ORDER BY d.id DESC LIMIT 50`).all() });
});
app.post('/api/delights', requireAuth, (req, res) => {
  if (!req.body?.text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO delights (client_id, text, by_id, by_name) VALUES (?, ?, ?, ?)`)
    .run(req.body.client_id || null, req.body.text.trim(), req.user.id, req.user.name);
  res.json({ ok: true });
});

// Lineup + Wow Stories (culture)
app.get('/api/lineup', requireAuth, (req, res) => {
  const value = SERVICE_VALUES[Math.floor(Date.now() / 864e5) % SERVICE_VALUES.length];
  const wows = db.prepare(`SELECT w.*, c.pref FROM wows w LEFT JOIN clients c ON c.id = w.client_id ORDER BY w.id DESC LIMIT 20`).all();
  res.json({ value, wows });
});
app.post('/api/wows', requireAuth, (req, res) => {
  if (!req.body?.text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO wows (text, client_id, recognize, by_id, by_name) VALUES (?, ?, ?, ?, ?)`)
    .run(req.body.text.trim(), req.body.client_id || null, req.body.recognize || null, req.user.id, req.user.name);
  res.json({ ok: true });
});
app.post('/api/staff-pulse', requireAuth, (req, res) => {
  db.prepare(`INSERT INTO staff_pulses (user_id, load, note, date) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, req.body?.load || null, req.body?.note || null, new Date().toISOString().slice(0, 10));
  res.json({ ok: true });
});

// Client voice
app.post('/api/client-experience', requireAuth, (req, res) => {
  const { client_id, cared, comment } = req.body || {};
  if (!client_id || !cared) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO client_experience (client_id, cared, comment, by_id, date) VALUES (?, ?, ?, ?, ?)`)
    .run(client_id, +cared, comment || null, req.user.id, new Date().toISOString().slice(0, 10));
  res.json({ ok: true });
});

// Outcomes + milestones
app.get('/api/outcomes', requireAuth, (req, res) => {
  const disc = db.prepare(`SELECT discharge_status s, COUNT(*) n FROM clients WHERE discharge_status IS NOT NULL GROUP BY discharge_status`).all();
  const counts = {}; disc.forEach((r) => { counts[r.s] = r.n; });
  const completed = counts.Completed || 0, ama = counts.AMA || 0, transferred = counts.Transferred || 0;
  const denom = completed + ama;
  const amaRate = denom ? Math.round((ama / denom) * 100) : 0;
  const completionRate = denom ? Math.round((completed / denom) * 100) : 0;
  const active = db.prepare(`SELECT COUNT(*) n FROM clients WHERE active = 1 AND discharge_status IS NULL`).get().n;
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const ce = db.prepare(`SELECT AVG(cared) a, COUNT(*) n FROM client_experience WHERE date >= ?`).get(since);
  const openConcerns = db.prepare(`SELECT COUNT(*) n FROM concerns WHERE status = 'Open'`).get().n;
  const delights30 = db.prepare(`SELECT COUNT(*) n FROM delights WHERE created_at >= datetime('now','-30 day')`).get().n;

  const clients = db.prepare(`SELECT pref, name, sober FROM clients WHERE active = 1 AND discharge_status IS NULL AND sober IS NOT NULL AND sober != ''`).all();
  const now = Date.now();
  const milestones = [];
  clients.forEach((c) => {
    [7, 30, 60, 90].forEach((d) => {
      const ms = new Date(c.sober + 'T00:00').getTime() + d * 864e5;
      const inDays = Math.round((ms - now) / 864e5);
      if (inDays >= 0 && inDays <= 7) milestones.push({ client: c.pref || c.name, label: `${d} days sober`, date: new Date(ms).toISOString().slice(0, 10), inDays });
    });
  });
  milestones.sort((a, b) => a.inDays - b.inDays);

  res.json({ amaRate, completionRate, completed, ama, transferred, active,
    feltCare: ce.a ? Math.round(ce.a * 10) / 10 : null, feltCareN: ce.n,
    openConcerns, delights30, milestones, surveys: surveyMetrics(30) });
});

/* ---------------- Departments, Concierge, Program, Goals, Journey, AI briefs ---------------- */

// Concierge requests
app.get('/api/requests', requireAuth, (req, res) => {
  let sql = `SELECT r.*, c.pref, c.name FROM requests r LEFT JOIN clients c ON c.id = r.client_id WHERE 1=1`;
  const args = [];
  if (req.query.status) { sql += ` AND r.status = ?`; args.push(req.query.status); }
  if (req.query.department) { sql += ` AND r.department = ?`; args.push(req.query.department); }
  sql += ` ORDER BY (r.status = 'Done'), (r.priority = 'High') DESC, r.id DESC LIMIT 200`;
  res.json({ requests: db.prepare(sql).all(...args) });
});
app.post('/api/requests', requireAuth, (req, res) => {
  const { client_id, department, text, priority } = req.body || {};
  if (!department || !text?.trim()) return res.status(400).json({ error: 'Missing department or text' });
  db.prepare(`INSERT INTO requests (client_id, department, text, priority, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(client_id || null, department, text.trim(), priority === 'High' ? 'High' : 'Normal', req.user.id, req.user.name);
  audit({ user: req.user, action: 'REQUEST', entity: 'client', entity_id: client_id ? +client_id : null, detail: department, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/requests/:id/status', requireAuth, (req, res) => {
  const st = ['Open', 'In progress', 'Done'].includes(req.body?.status) ? req.body.status : 'Done';
  db.prepare(`UPDATE requests SET status = ?, done_by = CASE WHEN ? = 'Done' THEN ? ELSE done_by END, done_at = CASE WHEN ? = 'Done' THEN datetime('now') ELSE done_at END WHERE id = ?`)
    .run(st, st, req.user.id, st, req.params.id);
  res.json({ ok: true });
});

// Program / schedule
app.get('/api/schedule', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json({ date, items: db.prepare(`SELECT s.*, c.pref FROM schedule_items s LEFT JOIN clients c ON c.id = s.client_id WHERE s.date = ? ORDER BY (s.time IS NULL), s.time, s.id`).all(date) });
});
app.post('/api/schedule', requireAuth, (req, res) => {
  const { date, time, title, type, location, client_id } = req.body || {};
  if (!date || !title?.trim()) return res.status(400).json({ error: 'Missing date or title' });
  db.prepare(`INSERT INTO schedule_items (date, time, title, type, location, client_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(date, time || null, title.trim(), SCHEDULE_TYPES.includes(type) ? type : 'Group', location || null, client_id || null, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/schedule/:id', requireAuth, (req, res) => { db.prepare(`DELETE FROM schedule_items WHERE id = ?`).run(req.params.id); res.json({ ok: true }); });

// Treatment goals
app.get('/api/goals', requireAuth, (req, res) => {
  res.json({ goals: db.prepare(`SELECT * FROM goals WHERE client_id = ? ORDER BY (status = 'Met'), id DESC`).all(req.query.client_id) });
});
app.post('/api/goals', requireAuth, (req, res) => {
  const { client_id, text, target_date } = req.body || {};
  if (!client_id || !text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO goals (client_id, text, target_date) VALUES (?, ?, ?)`).run(client_id, text.trim(), target_date || null);
  res.json({ ok: true });
});
app.post('/api/goals/:id/status', requireAuth, (req, res) => {
  const met = req.body?.status === 'Met';
  db.prepare(`UPDATE goals SET status = ?, met_at = ? WHERE id = ?`).run(met ? 'Met' : 'Active', met ? new Date().toISOString().slice(0, 10) : null, req.params.id);
  res.json({ ok: true });
});

// Client 360 journey — everything about one client, in one place
app.get('/api/clients/:id/journey', requireAuth, (req, res) => {
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const today = new Date().toISOString().slice(0, 10);
  c.tasks = db.prepare(`SELECT * FROM tasks WHERE client_id = ? ORDER BY sort, id`).all(c.id);
  audit({ user: req.user, action: 'VIEW', entity: 'client', entity_id: c.id, detail: 'journey', ip: req.ip });
  res.json({ journey: {
    client: c,
    ama: latestAmaRead(c.id),
    pulses: recentPulses(c.id, 5),
    requests: db.prepare(`SELECT * FROM requests WHERE client_id = ? AND status != 'Done' ORDER BY id DESC`).all(c.id),
    concerns: db.prepare(`SELECT * FROM concerns WHERE client_id = ? AND status = 'Open' ORDER BY id DESC`).all(c.id),
    delights: db.prepare(`SELECT d.*, u.name by_name2 FROM delights d LEFT JOIN users u ON u.id = d.by_id WHERE d.client_id = ? ORDER BY d.id DESC LIMIT 5`).all(c.id),
    goals: db.prepare(`SELECT * FROM goals WHERE client_id = ? ORDER BY (status = 'Met'), id DESC`).all(c.id),
    schedule: db.prepare(`SELECT * FROM schedule_items WHERE client_id = ? AND date = ? ORDER BY time`).all(c.id, today),
    followups: db.prepare(`SELECT * FROM followups WHERE client_id = ? AND status = 'Pending' ORDER BY due_date`).all(c.id),
  } });
});

function buildClientContext(c) {
  const line = (l, v) => (v && String(v).trim() ? `${l}: ${v}\n` : '');
  const ama = latestAmaRead(c.id);
  const pulses = recentPulses(c.id, 5);
  const goals = db.prepare(`SELECT text, status FROM goals WHERE client_id = ?`).all(c.id);
  const reqs = db.prepare(`SELECT department, text FROM requests WHERE client_id = ? AND status != 'Done'`).all(c.id);
  const concerns = db.prepare(`SELECT text FROM concerns WHERE client_id = ? AND status = 'Open'`).all(c.id);
  return `Brief this client for the team today.\n\n` +
    line('Preferred name', c.pref) + line('Name', c.name) + line('Program', c.program) +
    line('Admitted', c.admit) + line('Sobriety date', c.sober) + line('Personal touch', c.touch) +
    line('Preferences', c.prefs) + line('Goals (free text)', c.goals) + line('Triggers', c.triggers) +
    line('Safety', c.safety) + line('Allergies', c.allergies) + line('Medications', c.medications) +
    line('Support', c.support) + line('Welcome plan', c.welcome_plan) +
    (ama ? `\nAMA risk: ${ama.level}. ${ama.summary || ''} Underlying: ${ama.underlying || ''}\n` : '') +
    (goals.length ? `\nTreatment goals:\n` + goals.map((g) => `- ${g.text} [${g.status}]`).join('\n') + '\n' : '') +
    (pulses.length ? `\nRecent pulses:\n` + pulses.map((p) => `- ${p.date} ${p.shift} concern:${p.concern} ${(p.triggers || []).join(', ')} ${p.statements || ''}`).join('\n') + '\n' : '') +
    (reqs.length ? `\nOpen requests: ` + reqs.map((r) => `${r.department}: ${r.text}`).join('; ') + '\n' : '') +
    (concerns.length ? `\nOpen concerns: ` + concerns.map((r) => r.text).join('; ') + '\n' : '');
}

function buildHouseContext(shift) {
  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room`).all();
  let ctx = `Shift briefing for ${shift || 'this'} shift. ${clients.length} active clients.\n\n`;
  clients.forEach((c) => {
    const ama = latestAmaRead(c.id);
    const reqs = db.prepare(`SELECT text FROM requests WHERE client_id = ? AND status != 'Done'`).all(c.id);
    const parts = [];
    if (ama && ama.level !== 'Low') parts.push(`AMA risk ${ama.level}: ${ama.summary || ''}`);
    if (c.safety) parts.push(`safety: ${c.safety}`);
    if (reqs.length) parts.push(`open requests: ${reqs.map((r) => r.text).join('; ')}`);
    if (c.touch) parts.push(`personal touch: ${c.touch}`);
    ctx += `• ${c.pref || c.name}${c.room ? ' (Room ' + c.room + ')' : ''}: ${parts.join(' | ') || 'stable'}\n`;
  });
  const oc = db.prepare(`SELECT co.text, c.pref FROM concerns co JOIN clients c ON c.id = co.client_id WHERE co.status = 'Open'`).all();
  if (oc.length) ctx += `\nOpen concerns: ` + oc.map((o) => `${o.pref}: ${o.text}`).join('; ') + '\n';
  return ctx;
}

app.post('/api/clients/:id/care-brief', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured (set ANTHROPIC_API_KEY).' });
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  try {
    const brief = await generateCareBrief(buildClientContext(c));
    audit({ user: req.user, action: 'CARE_BRIEF', entity: 'client', entity_id: c.id, ip: req.ip });
    res.json({ brief });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/shift-briefing', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured (set ANTHROPIC_API_KEY).' });
  try {
    const brief = await generateShiftBriefing(buildHouseContext(req.body?.shift));
    audit({ user: req.user, action: 'SHIFT_BRIEF', ip: req.ip });
    res.json({ brief });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Surveys (client experience & meals) ---------------- */
app.get('/api/surveys', requireAuth, (req, res) => {
  const surveys = db.prepare(`SELECT * FROM surveys WHERE active = 1 ORDER BY sort, id`).all();
  for (const s of surveys) s.questions = db.prepare(`SELECT id, category, text, type, sort FROM survey_questions WHERE survey_id = ? ORDER BY sort, id`).all(s.id);
  res.json({ surveys });
});

app.post('/api/surveys/:id/respond', requireAuth, (req, res) => {
  const survey = db.prepare(`SELECT id FROM surveys WHERE id = ?`).get(req.params.id);
  if (!survey) return res.status(404).json({ error: 'Not found' });
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (!answers.length) return res.status(400).json({ error: 'No answers' });
  const info = db.prepare(`INSERT INTO survey_responses (survey_id, client_id, submitted_by) VALUES (?, ?, ?)`)
    .run(survey.id, req.body.client_id || null, req.user.id);
  const rid = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO survey_answers (response_id, question_id, value_num, value_text) VALUES (?, ?, ?, ?)`);
  for (const a of answers) {
    if (a.question_id == null) continue;
    const num = (a.num === 0 || a.num) ? Number(a.num) : null;
    const text = a.text?.trim() ? a.text.trim() : null;
    if (num == null && text == null) continue;
    ins.run(rid, a.question_id, num, text);
  }
  audit({ user: req.user, action: 'SURVEY', entity: 'survey', entity_id: survey.id, detail: req.body.client_id ? 'client ' + req.body.client_id : 'anonymous', ip: req.ip });
  res.json({ ok: true });
});

// Surveys that are due: discharge survey after discharge, experience survey weekly.
app.get('/api/surveys/due', requireAuth, (req, res) => {
  const exp = db.prepare(`SELECT id FROM surveys WHERE key = 'experience'`).get();
  const dis = db.prepare(`SELECT id FROM surveys WHERE key = 'discharge'`).get();
  const due = [];
  if (exp) {
    db.prepare(
      `SELECT c.id, c.pref, c.name FROM clients c
       WHERE c.active = 1 AND c.discharge_status IS NULL
       AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = ? AND r.client_id = c.id AND r.created_at >= datetime('now','-7 day'))
       ORDER BY c.room, c.name`).all(exp.id)
      .forEach((c) => due.push({ survey_id: exp.id, title: 'Client Experience Survey', client_id: c.id, client: c.pref || c.name, reason: 'No experience survey in the last 7 days' }));
  }
  if (dis) {
    db.prepare(
      `SELECT c.id, c.pref, c.name, c.discharge_date FROM clients c
       WHERE c.discharge_status IS NOT NULL AND c.discharge_status != 'Transferred' AND c.discharge_date >= date('now','-30 day')
       AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = ? AND r.client_id = c.id)
       ORDER BY c.discharge_date DESC`).all(dis.id)
      .forEach((c) => due.push({ survey_id: dis.id, title: 'Discharge Experience Survey', client_id: c.id, client: c.pref || c.name, reason: `Discharged ${c.discharge_date} — survey not done` }));
  }
  res.json({ due });
});

// Results (admin): per-question aggregates + recent comments.
app.get('/api/surveys/:id/results', requireAuth, requireAdmin, (req, res) => {
  const survey = db.prepare(`SELECT * FROM surveys WHERE id = ?`).get(req.params.id);
  if (!survey) return res.status(404).json({ error: 'Not found' });
  const responses = db.prepare(`SELECT COUNT(*) n FROM survey_responses WHERE survey_id = ?`).get(survey.id).n;
  const questions = db.prepare(`SELECT id, category, text, type, sort FROM survey_questions WHERE survey_id = ? ORDER BY sort, id`).all(survey.id);
  for (const q of questions) {
    if (q.type === 'scale' || q.type === 'rating') {
      const r = db.prepare(`SELECT AVG(value_num) a, COUNT(value_num) n FROM survey_answers WHERE question_id = ?`).get(q.id);
      q.avg = r.a != null ? Math.round(r.a * 10) / 10 : null; q.count = r.n;
    } else if (q.type === 'yesno') {
      const r = db.prepare(`SELECT AVG(value_num) a, COUNT(value_num) n FROM survey_answers WHERE question_id = ?`).get(q.id);
      q.yesPct = r.a != null ? Math.round(r.a * 100) : null; q.count = r.n;
    } else {
      q.comments = db.prepare(`SELECT value_text FROM survey_answers WHERE question_id = ? AND value_text IS NOT NULL ORDER BY id DESC LIMIT 20`).all(q.id).map((x) => x.value_text);
      q.count = q.comments.length;
    }
  }
  res.json({ survey, responses, questions });
});

// Weekly leadership report (admin): preview the HTML, or send it now.
app.get('/api/report/weekly', requireAuth, requireAdmin, (req, res) => {
  res.json({ html: renderReportHtml(buildWeeklyData()), emailConfigured: emailConfigured() });
});
app.post('/api/report/send', requireAuth, requireAdmin, async (req, res) => {
  if (!emailConfigured()) return res.status(503).json({ error: 'Email not set up. Add RESEND_API_KEY and REPORT_TO.' });
  try {
    await sendWeeklyReport();
    audit({ user: req.user, action: 'REPORT_SEND', detail: 'weekly', ip: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// In-app weekly scheduler (no external cron needed; the web service is always-on).
function maybeSendWeeklyReport() {
  if (!emailConfigured()) return;
  const now = new Date();
  const wantDay = Number(process.env.REPORT_DAY ?? 1);   // 0=Sun … 1=Mon
  const wantHour = Number(process.env.REPORT_HOUR ?? 13); // UTC hour (~8am ET)
  if (now.getUTCDay() !== wantDay || now.getUTCHours() !== wantHour) return;
  const todayStr = now.toISOString().slice(0, 10);
  if (getState('weekly_report_sent') === todayStr) return;
  setState('weekly_report_sent', todayStr);
  sendWeeklyReport().catch((e) => console.error('Weekly report failed:', e.message));
}
setInterval(maybeSendWeeklyReport, 60 * 60 * 1000);
maybeSendWeeklyReport();

/* ---------------- static ---------------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Armada Care Standards running on http://localhost:${PORT}`));

// Armada Care Standards — multi-user server
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, audit } from './src/db.js';
import {
  cookies, login, logout, currentUser, requireAuth, requireAdmin, createUser,
} from './src/auth.js';
import { ensureAdmin, ensureSampleData } from './src/seed.js';

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

const CLIENT_FIELDS = ['name', 'pref', 'room', 'program', 'admit', 'sober', 'touch', 'prefs', 'goals', 'triggers', 'safety', 'support'];

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

  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 ORDER BY room, name`).all();
  const done = new Set(db.prepare(`SELECT task_id FROM completions WHERE shift_id = ?`).all(shift.id).map(r => r.task_id));
  const handoffs = db.prepare(`SELECT * FROM handoffs WHERE shift_id = ? ORDER BY created_at`).all(shift.id);

  const out = [];
  for (const c of clients) {
    const tasks = db.prepare(
      `SELECT * FROM tasks WHERE client_id = ? AND shift = ? AND (job_role = 'All' OR ? = 'All' OR job_role = ?)
       ORDER BY (priority='High') DESC, sort`
    ).all(c.id, name, role, role);
    if (!tasks.length && !c.safety && !c.touch) continue;
    out.push({
      ...c,
      tasks: tasks.map(t => ({ ...t, done: done.has(t.id) })),
      handoffs: handoffs.filter(h => h.client_id === c.id),
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

app.get('/api/meta', requireAuth, (req, res) => res.json({ shifts: SHIFTS, jobRoles: JOB_ROLES }));

/* ---------------- static ---------------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Armada Care Standards running on http://localhost:${PORT}`));

// Armada Care Standards — multi-user server
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, audit, getState, setState } from './src/db.js';
import { buildWeeklyData, renderReportHtml, sendWeeklyReport, emailConfigured, surveyMetrics, sendEmail, sendSms, smsConfigured } from './src/report.js';
import { STANDARD_SECTIONS, NORTH_STAR, MOTTO, TAGLINE } from './src/standard.js';
import { todaysFocus, FOCUS_TOPICS } from './src/db.js';
import { kipuConfigured, kipuTest, kipuSyncRoster } from './src/kipu.js';
import {
  cookies, login, logout, completeMfa, currentUser, requireAuth, requireAdmin, createUser, changePassword,
  mfaSetup, mfaEnable, mfaDisable,
} from './src/auth.js';
import { ensureAdmin, ensureSampleData } from './src/seed.js';
import { generateShiftTasks, generateAmaRead, generateCareBrief, generateShiftBriefing, askAssistant, scanNote, claudeConfigured, AMA_TRIGGERS } from './src/claude.js';

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
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const SHIFTS = ['Morning', 'Day', 'Evening', 'Night'];
const JOB_ROLES = ['BHT / Tech', 'Nurse', 'Therapist', 'Kitchen'];
const DEPARTMENTS = ['Front Desk / Concierge', 'Clinical / Therapy', 'Nurse / Medical (comfort, not feeling well)', 'Kitchen / Dietary', 'Housekeeping', 'Maintenance', 'Transportation', 'Activities / Recreation', 'Family Services', 'Spiritual Care'];
const SCHEDULE_TYPES = ['Group', 'Activity', 'Meal', 'Outing', 'Appointment', 'Wellness'];

/* ---------------- auth ---------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = login(req, res, username || '', password || '');
  if (!result) return res.status(401).json({ error: 'Invalid username or password' });
  if (result.mfaRequired) return res.json({ mfaRequired: true, ticket: result.ticket });
  res.json({ user: result });
});
app.post('/api/login/mfa', (req, res) => {
  const user = completeMfa(req, res, req.body?.ticket || '', req.body?.code || '');
  if (!user) return res.status(401).json({ error: 'Invalid or expired code' });
  res.json({ user });
});
app.get('/api/mfa/setup', requireAuth, (req, res) => res.json(mfaSetup(req.user.id, req.user.username)));
app.post('/api/mfa/enable', requireAuth, (req, res) => {
  if (!mfaEnable(req.user.id, req.body?.code)) return res.status(400).json({ error: 'Code did not match — try again.' });
  audit({ user: req.user, action: 'MFA_ENABLE', ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/mfa/disable', requireAuth, (req, res) => { mfaDisable(req.user.id); audit({ user: req.user, action: 'MFA_DISABLE', ip: req.ip }); res.json({ ok: true }); });

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

const CLIENT_FIELDS = ['name', 'pref', 'room', 'program', 'admit', 'sober', 'touch', 'prefs', 'goals', 'triggers', 'safety', 'support', 'welcome_plan', 'aftercare_plan'];

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
  if (b.concern === 'High') {
    const c = db.prepare(`SELECT pref, name FROM clients WHERE id = ?`).get(b.client_id);
    createAlert(b.client_id, 'concern', 'High', `${c?.pref || c?.name || 'A client'} — High-concern pulse${b.statements ? `: "${b.statements}"` : ''}. Check in now.`);
  }
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

// Notify the posted on-call leader by text/email (voice-first principle: the
// alert reaches a human, it doesn't sit unread). Best-effort, non-blocking.
function notifyOnCall(message) {
  const email = getState('oncall_email') || process.env.ONCALL_EMAIL;
  const phone = getState('oncall_phone') || process.env.ONCALL_PHONE;
  if (email && emailConfigured()) sendEmail({ to: email, subject: 'Armada — on-call alert', html: `<p style="font-family:Georgia,serif">${message}</p><p style="color:#888">Go to the client in person. A human goes to the patient — never a chat.</p>` }).catch((e) => console.error('on-call email:', e.message));
  if (phone && smsConfigured()) sendSms({ to: phone, body: `Armada alert: ${message}`.slice(0, 300) }).catch((e) => console.error('on-call sms:', e.message));
}

// Proactive alert: surfaced the moment a client's signals turn. De-duped so we
// don't repeat the same open alert for the same client+kind.
function createAlert(client_id, kind, level, message) {
  const dup = db.prepare(`SELECT 1 FROM alerts WHERE client_id = ? AND kind = ? AND status = 'New' AND created_at >= datetime('now','-1 day') LIMIT 1`).get(client_id, kind);
  if (dup) return;
  db.prepare(`INSERT INTO alerts (client_id, kind, level, message) VALUES (?, ?, ?, ?)`).run(client_id || null, kind, level || null, message);
  if (level === 'High' || level === 'Critical') {
    // PHI-free by default — the detailed message stays in the app (behind login).
    const phiFree = process.env.ALERT_INCLUDE_PHI !== 'true';
    notifyOnCall(phiFree ? `${level} alert — a client needs attention now. Open Armada to view (details kept in-app for privacy).` : message);
  }
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
  if (read.level === 'High' || read.level === 'Elevated')
    createAlert(client.id, 'risk', read.level, `${client.pref || client.name} — AMA risk ${read.level}: ${read.summary || 'review the action plan'}`);
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
      trend: db.prepare(`SELECT level FROM ama_reads WHERE client_id = ? ORDER BY id DESC LIMIT 8`).all(c.id).reverse().map((r) => ({ High: 3, Elevated: 2, Low: 1 }[r.level] || 0)),
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
  const so = db.prepare(`SELECT crisis_owner_id, crisis_owner_name FROM shifts WHERE id = ?`).get(shift.id);
  res.json({ shift, assignees, clients: out, role, crisisOwner: so?.crisis_owner_name || null, staff: db.prepare(`SELECT id, name FROM users WHERE active = 1 ORDER BY name`).all() });
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

app.get('/api/meta', requireAuth, (req, res) => res.json({ shifts: SHIFTS, jobRoles: JOB_ROLES, claude: claudeConfigured(), amaTriggers: AMA_TRIGGERS, departments: DEPARTMENTS, scheduleTypes: SCHEDULE_TYPES, kioskCode: req.user.role === 'admin' ? kioskCode() : undefined }));

// Change my own password.
app.post('/api/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (!changePassword(req.user.id, current || '', next)) return res.status(400).json({ error: 'Current password is incorrect.' });
  audit({ user: req.user, action: 'PASSWORD_CHANGE', ip: req.ip });
  res.json({ ok: true });
});

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
  const b = req.body || {};
  const steps = b.steps ? JSON.stringify(b.steps) : null;
  db.prepare(`UPDATE clients SET discharge_status = ?, discharge_date = ?, departure_steps = ?, discharge_reason = ?, discharge_followthrough = ?, discharge_improve = ? WHERE id = ?`)
    .run(status, d, steps, b.reason || null, b.followthrough || null, b.improve || null, req.params.id);
  if (status !== 'Transferred') {
    // Aftercare calls are REQUIRED tasks, auto-assigned to the Aftercare Coordinator.
    const coordId = getState('aftercare_coordinator');
    const coord = coordId ? db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(coordId) : null;
    const base = new Date(d + 'T00:00').getTime();
    const ins = db.prepare(`INSERT INTO followups (client_id, type, due_date, assignee_id, assignee_name) VALUES (?, ?, ?, ?, ?)`);
    [[1, '24h'], [2, '48h'], [30, '30d']].forEach(([days, type]) =>
      ins.run(req.params.id, type, new Date(base + days * 864e5).toISOString().slice(0, 10), coord?.id || null, coord?.name || null));
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

/* ---------------- Assigned tasks ("tasks per employee") + My Tasks ---------------- */
app.get('/api/my-tasks', requireAuth, (req, res) => {
  const calls = db.prepare(`SELECT f.id, f.type, f.due_date, c.pref, c.name, c.id cid FROM followups f JOIN clients c ON c.id = f.client_id WHERE f.status = 'Pending' AND f.assignee_id = ? ORDER BY f.due_date`).all(req.user.id);
  const tasks = db.prepare(`SELECT t.*, c.pref FROM assigned_tasks t LEFT JOIN clients c ON c.id = t.client_id WHERE t.status = 'Open' AND t.assignee_id = ? ORDER BY (t.due_date IS NULL), t.due_date, t.id`).all(req.user.id);
  res.json({ calls, tasks, today: new Date().toISOString().slice(0, 10) });
});
app.get('/api/all-tasks', requireAuth, requireAdmin, (req, res) => {
  res.json({
    calls: db.prepare(`SELECT f.id, f.type, f.due_date, f.assignee_name, c.pref FROM followups f JOIN clients c ON c.id = f.client_id WHERE f.status = 'Pending' ORDER BY f.due_date`).all(),
    tasks: db.prepare(`SELECT t.*, c.pref FROM assigned_tasks t LEFT JOIN clients c ON c.id = t.client_id WHERE t.status = 'Open' ORDER BY (t.due_date IS NULL), t.due_date`).all(),
  });
});
app.post('/api/assigned-tasks', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.assignee_id || !b.title?.trim()) return res.status(400).json({ error: 'Pick a teammate and a task' });
  const u = db.prepare(`SELECT name FROM users WHERE id = ?`).get(b.assignee_id);
  db.prepare(`INSERT INTO assigned_tasks (title, detail, client_id, assignee_id, assignee_name, assigned_by, source, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.title.trim(), b.detail || null, b.client_id || null, b.assignee_id, u?.name || null, req.user.name, b.source || 'manual', b.due_date || null);
  res.json({ ok: true });
});
app.post('/api/assigned-tasks/:id/done', requireAuth, (req, res) => {
  db.prepare(`UPDATE assigned_tasks SET status = 'Done', done_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/settings', requireAuth, requireAdmin, (req, res) => {
  const id = getState('aftercare_coordinator');
  res.json({
    aftercareCoordinator: id ? db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(id) : null,
    staff: db.prepare(`SELECT id, name FROM users WHERE active = 1 ORDER BY name`).all(),
    oncallEmail: getState('oncall_email') || process.env.ONCALL_EMAIL || '',
    oncallPhone: getState('oncall_phone') || process.env.ONCALL_PHONE || '',
    emailReady: emailConfigured(), smsReady: smsConfigured(), claudeReady: claudeConfigured(),
    kioskCode: kioskCode(),
  });
});
app.post('/api/settings/kiosk-code', requireAuth, requireAdmin, (req, res) => {
  setState('kiosk_code', (req.body?.code || '').trim());
  res.json({ ok: true });
});
app.post('/api/settings/test-alert', requireAuth, requireAdmin, (req, res) => {
  notifyOnCall('TEST — your on-call alerts are working. (No action needed.)');
  res.json({ ok: true, emailReady: emailConfigured(), smsReady: smsConfigured() });
});
// Kipu EMR integration (admin)
app.get('/api/kipu/status', requireAuth, requireAdmin, (req, res) => res.json({ configured: kipuConfigured() }));
app.post('/api/kipu/test', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await kipuTest()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/kipu/sync', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await kipuSyncRoster(); audit({ user: req.user, action: 'KIPU_SYNC', detail: `${r.created} new`, ip: req.ip }); res.json(r); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/settings/aftercare-coordinator', requireAuth, requireAdmin, (req, res) => {
  setState('aftercare_coordinator', String(req.body?.user_id || ''));
  res.json({ ok: true });
});
app.post('/api/settings/oncall', requireAuth, requireAdmin, (req, res) => {
  setState('oncall_email', (req.body?.email || '').trim());
  setState('oncall_phone', (req.body?.phone || '').trim());
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
  if (priority === 'High') createAlert(client_id || null, 'request', 'High', `High-priority request — ${department}: ${text.trim().slice(0, 80)}`);
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
    amaHistory: db.prepare(`SELECT level, created_at FROM ama_reads WHERE client_id = ? ORDER BY id DESC LIMIT 12`).all(c.id).reverse(),
    pulses: recentPulses(c.id, 5),
    requests: db.prepare(`SELECT * FROM requests WHERE client_id = ? AND status != 'Done' ORDER BY id DESC`).all(c.id),
    concerns: db.prepare(`SELECT * FROM concerns WHERE client_id = ? AND status = 'Open' ORDER BY id DESC`).all(c.id),
    delights: db.prepare(`SELECT d.*, u.name by_name2 FROM delights d LEFT JOIN users u ON u.id = d.by_id WHERE d.client_id = ? ORDER BY d.id DESC LIMIT 5`).all(c.id),
    goals: db.prepare(`SELECT * FROM goals WHERE client_id = ? ORDER BY (status = 'Met'), id DESC`).all(c.id),
    schedule: db.prepare(`SELECT * FROM schedule_items WHERE client_id = ? AND date = ? ORDER BY time`).all(c.id, today),
    followups: db.prepare(`SELECT * FROM followups WHERE client_id = ? AND status = 'Pending' ORDER BY due_date`).all(c.id),
    family: db.prepare(`SELECT * FROM family_contacts WHERE client_id = ? ORDER BY id`).all(c.id),
    visits: db.prepare(`SELECT * FROM visits WHERE client_id = ? AND date >= date('now') AND status = 'Scheduled' ORDER BY date, time`).all(c.id),
  } });
});

function buildClientContext(c) {
  const line = (l, v) => (v && String(v).trim() ? `${l}: ${v}\n` : '');
  const ama = latestAmaRead(c.id);
  const pulses = recentPulses(c.id, 5);
  const goals = db.prepare(`SELECT text, status FROM goals WHERE client_id = ?`).all(c.id);
  const reqs = db.prepare(`SELECT department, text FROM requests WHERE client_id = ? AND status != 'Done'`).all(c.id);
  const concerns = db.prepare(`SELECT text FROM concerns WHERE client_id = ? AND status = 'Open'`).all(c.id);
  const visit = db.prepare(`SELECT contact_name, date FROM visits WHERE client_id = ? AND date >= date('now') AND status = 'Scheduled' ORDER BY date LIMIT 1`).get(c.id);
  return `Brief this client for the team today.\n\n` +
    line('Preferred name', c.pref) + line('Name', c.name) + line('Program', c.program) +
    line('Admitted', c.admit) + line('Sobriety date', c.sober) + line('Personal touch', c.touch) +
    line('Preferences', c.prefs) + line('Goals (free text)', c.goals) + line('Triggers', c.triggers) +
    line('Safety', c.safety) +
    line('Support', c.support) + line('Welcome plan', c.welcome_plan) +
    (ama ? `\nAMA risk: ${ama.level}. ${ama.summary || ''} Underlying: ${ama.underlying || ''}\n` : '') +
    (goals.length ? `\nGoals:\n` + goals.map((g) => `- ${g.text} [${g.status}]`).join('\n') + '\n' : '') +
    (pulses.length ? `\nRecent pulses:\n` + pulses.map((p) => `- ${p.date} ${p.shift} concern:${p.concern} ${(p.triggers || []).join(', ')} ${p.statements || ''}`).join('\n') + '\n' : '') +
    (visit ? `\nUpcoming family visit: ${visit.contact_name || 'family'} on ${visit.date}\n` : '') +
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

/* ---------------- Today: command center ---------------- */
function surveysDueCount() {
  const exp = db.prepare(`SELECT id FROM surveys WHERE key = 'experience'`).get();
  const dis = db.prepare(`SELECT id FROM surveys WHERE key = 'discharge'`).get();
  let n = 0;
  if (exp) n += db.prepare(`SELECT COUNT(*) n FROM clients c WHERE c.active=1 AND c.discharge_status IS NULL AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id=? AND r.client_id=c.id AND r.created_at >= datetime('now','-7 day'))`).get(exp.id).n;
  if (dis) n += db.prepare(`SELECT COUNT(*) n FROM clients c WHERE c.discharge_status IS NOT NULL AND c.discharge_status!='Transferred' AND c.discharge_date >= date('now','-30 day') AND NOT EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id=? AND r.client_id=c.id)`).get(dis.id).n;
  return n;
}
app.get('/api/today', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const attention = [];
  for (const c of clients) {
    const ama = latestAmaRead(c.id);
    if (ama && ama.level !== 'Low') attention.push({ kind: 'risk', level: ama.level, client_id: c.id, text: `${c.pref || c.name} — AMA risk ${ama.level}${ama.summary ? ': ' + ama.summary : ''}` });
    if (c.admit && (Date.now() - new Date(c.admit + 'T00:00').getTime()) <= 3 * 864e5) attention.push({ kind: 'welcome', client_id: c.id, text: `${c.pref || c.name} — in the first 72 hours. Deliver the welcome.` });
  }
  const callsDue = db.prepare(`SELECT f.type, f.due_date, c.pref, c.name, c.id cid FROM followups f JOIN clients c ON c.id=f.client_id WHERE f.status='Pending' AND f.due_date <= ? ORDER BY f.due_date`).all(today);
  callsDue.forEach((f) => attention.push({ kind: 'call', client_id: f.cid, text: `${f.pref || f.name} — ${f.type} aftercare call due ${f.due_date}` }));
  const hiReq = db.prepare(`SELECT r.text, r.department, c.pref FROM requests r LEFT JOIN clients c ON c.id=r.client_id WHERE r.status!='Done' AND r.priority='High' ORDER BY r.id DESC`).all();
  hiReq.forEach((r) => attention.push({ kind: 'request', text: `${r.department}: ${r.text}${r.pref ? ' (' + r.pref + ')' : ''}` }));
  const order = { risk: 0, welcome: 1, call: 2, request: 3 };
  attention.sort((a, b) => (order[a.kind] - order[b.kind]) || ((b.level === 'High') - (a.level === 'High')));

  const metrics = {
    active: clients.length,
    highRisk: attention.filter((a) => a.kind === 'risk').length,
    openRequests: db.prepare(`SELECT COUNT(*) n FROM requests WHERE status != 'Done'`).get().n,
    surveysDue: surveysDueCount(),
    bedsOpen: db.prepare(`SELECT COUNT(*) n FROM beds WHERE status = 'Open'`).get().n,
    pipeline: db.prepare(`SELECT COUNT(*) n FROM admissions WHERE status NOT IN ('Admitted','Declined')`).get().n,
    callsDue: callsDue.length,
    openConcerns: db.prepare(`SELECT COUNT(*) n FROM concerns WHERE status='Open'`).get().n,
    openIncidents: db.prepare(`SELECT COUNT(*) n FROM incidents WHERE status='Open'`).get().n,
    visitsToday: db.prepare(`SELECT COUNT(*) n FROM visits WHERE date = ? AND status='Scheduled'`).get(today).n,
    refreshersDue: (() => {
      const cs = db.prepare(`SELECT id, recert_days FROM courses WHERE active = 1`).all();
      const us = db.prepare(`SELECT id FROM users WHERE active = 1`).all();
      let n = 0; us.forEach((u) => cs.forEach((c) => { if (courseStatus(c, u.id).due) n++; })); return n;
    })(),
  };
  const schedule = db.prepare(`SELECT s.*, c.pref FROM schedule_items s LEFT JOIN clients c ON c.id=s.client_id WHERE s.date = ? ORDER BY (s.time IS NULL), s.time LIMIT 12`).all(today);
  const wins = {
    wows: db.prepare(`SELECT w.text, w.by_name, c.pref FROM wows w LEFT JOIN clients c ON c.id=w.client_id ORDER BY w.id DESC LIMIT 3`).all(),
    delights: db.prepare(`SELECT d.text, c.pref FROM delights d LEFT JOIN clients c ON c.id=d.client_id ORDER BY d.id DESC LIMIT 3`).all(),
  };
  const admitsToday = db.prepare(`SELECT id, pref, name, room, program FROM clients WHERE admit = ? AND active = 1`).all(today);
  const dischargesToday = db.prepare(`SELECT id, pref, name, discharge_status, discharge_reason FROM clients WHERE discharge_date = ?`).all(today);
  const myCalls = db.prepare(`SELECT COUNT(*) n FROM followups WHERE status = 'Pending' AND assignee_id = ? AND due_date <= ?`).get(req.user.id, today).n;
  const myTasks = db.prepare(`SELECT COUNT(*) n FROM assigned_tasks WHERE status = 'Open' AND assignee_id = ?`).get(req.user.id).n;
  res.json({ metrics, attention: attention.slice(0, 25), schedule, wins, claude: claudeConfigured(), focus: focusForDate(today), admitsToday, dischargesToday, myTaskCount: myCalls + myTasks });
});

// Ask Armada (AI concierge)
app.post('/api/assistant', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured (set ANTHROPIC_API_KEY).' });
  const q = (req.body?.question || '').trim();
  if (!q) return res.status(400).json({ error: 'Ask a question.' });
  try {
    let ctx;
    if (req.body?.client_id) {
      const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.body.client_id);
      ctx = c ? buildClientContext(c) : 'No such client.';
    } else {
      ctx = buildHouseContext('current');
    }
    const answer = await askAssistant(q, ctx);
    audit({ user: req.user, action: 'ASSISTANT', detail: q.slice(0, 80), ip: req.ip });
    res.json({ answer });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Incidents (quality & safety) ---------------- */
app.get('/api/incidents', requireAuth, (req, res) => {
  res.json({ incidents: db.prepare(`SELECT i.*, c.pref FROM incidents i LEFT JOIN clients c ON c.id = i.client_id ORDER BY (i.status='Closed'), i.id DESC LIMIT 100`).all() });
});
app.post('/api/incidents', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.type || !b.description?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO incidents (client_id, type, severity, description, action_taken, reported_by, reported_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(b.client_id || null, b.type, b.severity || 'Low', b.description.trim(), b.action_taken || null, req.user.id, req.user.name);
  if (b.severity === 'High' || b.severity === 'Critical') createAlert(b.client_id || null, 'incident', b.severity, `${b.severity} incident (${b.type}): ${b.description.trim().slice(0, 80)}`);
  audit({ user: req.user, action: 'INCIDENT', entity: 'client', entity_id: b.client_id ? +b.client_id : null, detail: `${b.type}/${b.severity}`, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/incidents/:id/status', requireAuth, (req, res) => {
  const st = ['Open', 'Reviewed', 'Closed'].includes(req.body?.status) ? req.body.status : 'Reviewed';
  db.prepare(`UPDATE incidents SET status = ? WHERE id = ?`).run(st, req.params.id);
  res.json({ ok: true });
});

/* ---------------- Family engagement ---------------- */
app.get('/api/clients/:id/family', requireAuth, (req, res) => {
  const cid = req.params.id;
  res.json({
    contacts: db.prepare(`SELECT * FROM family_contacts WHERE client_id = ? ORDER BY id`).all(cid),
    updates: db.prepare(`SELECT * FROM family_updates WHERE client_id = ? ORDER BY id DESC LIMIT 20`).all(cid),
    visits: db.prepare(`SELECT * FROM visits WHERE client_id = ? ORDER BY date DESC, time LIMIT 20`).all(cid),
  });
});
app.post('/api/family/contacts', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.client_id || !b.name?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO family_contacts (client_id, name, relationship, phone, email, can_update, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(b.client_id, b.name.trim(), b.relationship || null, b.phone || null, b.email || null, b.can_update === false ? 0 : 1, b.notes || null);
  res.json({ ok: true });
});
app.post('/api/family/updates', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.client_id || !b.text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO family_updates (client_id, contact_name, text, by_id, by_name) VALUES (?, ?, ?, ?, ?)`)
    .run(b.client_id, b.contact_name || null, b.text.trim(), req.user.id, req.user.name);
  audit({ user: req.user, action: 'FAMILY_UPDATE', entity: 'client', entity_id: +b.client_id, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/visits', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.client_id || !b.date) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO visits (client_id, contact_name, date, time, type, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(b.client_id, b.contact_name || null, b.date, b.time || null, b.type || 'In-person', b.notes || null);
  res.json({ ok: true });
});
app.post('/api/visits/:id/status', requireAuth, (req, res) => {
  const st = ['Scheduled', 'Completed', 'Cancelled'].includes(req.body?.status) ? req.body.status : 'Completed';
  db.prepare(`UPDATE visits SET status = ? WHERE id = ?`).run(st, req.params.id);
  res.json({ ok: true });
});

/* ---------------- Admissions pipeline + bed board ---------------- */
app.get('/api/admissions', requireAuth, (req, res) => {
  res.json({ admissions: db.prepare(`SELECT * FROM admissions WHERE status != 'Admitted' OR created_at >= datetime('now','-14 day') ORDER BY (status='Declined'), id DESC`).all() });
});
app.post('/api/admissions', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.name?.trim()) return res.status(400).json({ error: 'Missing name' });
  db.prepare(`INSERT INTO admissions (name, referral_source, phone, insurance, scheduled_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(b.name.trim(), b.referral_source || null, b.phone || null, b.insurance || null, b.scheduled_date || null, b.notes || null, req.user.id);
  res.json({ ok: true });
});
app.post('/api/admissions/:id/status', requireAuth, (req, res) => {
  const st = ['Inquiry', 'Screening', 'Scheduled', 'Admitted', 'Declined'].includes(req.body?.status) ? req.body.status : 'Inquiry';
  db.prepare(`UPDATE admissions SET status = ?, scheduled_date = COALESCE(?, scheduled_date) WHERE id = ?`).run(st, req.body?.scheduled_date || null, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admissions/:id/admit', requireAuth, (req, res) => {
  const a = db.prepare(`SELECT * FROM admissions WHERE id = ?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const room = req.body?.room || null;
  const info = db.prepare(`INSERT INTO clients (name, room, admit) VALUES (?, ?, ?)`).run(a.name, room, new Date().toISOString().slice(0, 10));
  const cid = info.lastInsertRowid;
  db.prepare(`UPDATE admissions SET status = 'Admitted', client_id = ? WHERE id = ?`).run(cid, a.id);
  if (req.body?.bed_id) db.prepare(`UPDATE beds SET status = 'Occupied', client_id = ? WHERE id = ?`).run(cid, req.body.bed_id);
  audit({ user: req.user, action: 'ADMIT', entity: 'client', entity_id: cid, detail: a.name, ip: req.ip });
  res.json({ ok: true, client_id: cid });
});
app.get('/api/beds', requireAuth, (req, res) => {
  res.json({ beds: db.prepare(`SELECT b.*, c.pref, c.name FROM beds b LEFT JOIN clients c ON c.id = b.client_id ORDER BY b.unit, b.room, b.label`).all() });
});
app.post('/api/beds', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.room?.trim()) return res.status(400).json({ error: 'Missing room' });
  db.prepare(`INSERT INTO beds (room, label, unit) VALUES (?, ?, ?)`).run(b.room.trim(), b.label || null, b.unit || null);
  res.json({ ok: true });
});
app.post('/api/beds/:id', requireAuth, (req, res) => {
  const st = ['Open', 'Occupied', 'Hold', 'Cleaning'].includes(req.body?.status) ? req.body.status : 'Open';
  const cid = req.body?.client_id || null;
  db.prepare(`UPDATE beds SET status = ?, client_id = ? WHERE id = ?`).run(st, st === 'Occupied' ? cid : null, req.params.id);
  res.json({ ok: true });
});

/* ---------------- Team: kudos + training ---------------- */
app.get('/api/staff', requireAuth, (req, res) => {
  res.json({ staff: db.prepare(`SELECT id, name, job_role FROM users WHERE active = 1 ORDER BY name`).all() });
});
app.get('/api/team', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    kudos: db.prepare(`SELECT * FROM kudos ORDER BY id DESC LIMIT 30`).all(),
    trainedToday: !!db.prepare(`SELECT 1 FROM training_ack WHERE user_id = ? AND date = ?`).get(req.user.id, today),
    trainingCount: db.prepare(`SELECT COUNT(*) n FROM training_ack WHERE date = ?`).get(today).n,
    pulseTrend: req.user.role === 'admin'
      ? db.prepare(`SELECT load, COUNT(*) n FROM staff_pulses WHERE created_at >= datetime('now','-7 day') GROUP BY load`).all()
      : null,
  });
});
app.post('/api/kudos', requireAuth, (req, res) => {
  const b = req.body || {}; if (!b.text?.trim()) return res.status(400).json({ error: 'Missing' });
  const to = b.to_user_id ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(b.to_user_id) : null;
  db.prepare(`INSERT INTO kudos (to_user_id, to_name, from_id, from_name, text) VALUES (?, ?, ?, ?, ?)`)
    .run(b.to_user_id || null, to?.name || null, req.user.id, req.user.name, b.text.trim());
  res.json({ ok: true });
});
app.post('/api/training-ack', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  if (!db.prepare(`SELECT 1 FROM training_ack WHERE user_id = ? AND date = ?`).get(req.user.id, today))
    db.prepare(`INSERT INTO training_ack (user_id, user_name, value_text, date) VALUES (?, ?, ?, ?)`).run(req.user.id, req.user.name, req.body?.value_text || null, today);
  res.json({ ok: true });
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

/* ---------------- Proactive alerts ---------------- */
app.get('/api/alerts', requireAuth, (req, res) => {
  const status = req.query.status || 'New';
  const rows = db.prepare(`SELECT a.*, c.pref FROM alerts a LEFT JOIN clients c ON c.id = a.client_id ${status === 'all' ? '' : 'WHERE a.status = ?'} ORDER BY a.id DESC LIMIT 100`)
    .all(...(status === 'all' ? [] : [status]));
  res.json({ alerts: rows, newCount: db.prepare(`SELECT COUNT(*) n FROM alerts WHERE status = 'New'`).get().n });
});
app.post('/api/alerts/:id/ack', requireAuth, (req, res) => {
  db.prepare(`UPDATE alerts SET status = 'Ack', ack_by = ?, ack_name = ?, ack_at = datetime('now') WHERE id = ?`).run(req.user.id, req.user.name, req.params.id);
  res.json({ ok: true });
});

/* ---------------- Employee accountability ---------------- */
// "Used" = care actions logged; "Missed" = assigned shifts with no logged action.
app.get('/api/accountability', requireAuth, requireAdmin, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const end = (m === 12 ? (y + 1) + '-01' : `${y}-${String(m + 1).padStart(2, '0')}`) + '-01';

  const users = db.prepare(`SELECT id, name, job_role FROM users WHERE active = 1`).all();
  const stat = {}; users.forEach((u) => { stat[u.id] = { id: u.id, name: u.name, job_role: u.job_role, actions: 0, breakdown: {}, assigned: 0, covered: 0, missed: 0 }; });

  // Care-action sources → (user, date). Each query has exactly two ? (start, end).
  const sources = {
    pulse: `SELECT author_id uid, date d FROM pulses WHERE date >= ? AND date < ?`,
    delight: `SELECT by_id uid, substr(created_at,1,10) d FROM delights WHERE created_at >= ? AND created_at < ?`,
    wow: `SELECT by_id uid, substr(created_at,1,10) d FROM wows WHERE created_at >= ? AND created_at < ?`,
    handoff: `SELECT author_id uid, substr(created_at,1,10) d FROM handoffs WHERE created_at >= ? AND created_at < ?`,
    'task done': `SELECT done_by uid, substr(done_at,1,10) d FROM completions WHERE done_at >= ? AND done_at < ?`,
    'request done': `SELECT done_by uid, substr(done_at,1,10) d FROM requests WHERE status = 'Done' AND done_at >= ? AND done_at < ?`,
    'family update': `SELECT by_id uid, substr(created_at,1,10) d FROM family_updates WHERE created_at >= ? AND created_at < ?`,
    survey: `SELECT submitted_by uid, substr(created_at,1,10) d FROM survey_responses WHERE created_at >= ? AND created_at < ?`,
    concern: `SELECT owner_id uid, substr(created_at,1,10) d FROM concerns WHERE created_at >= ? AND created_at < ?`,
  };
  const activeSet = new Set();  // uid|date
  for (const [label, sql] of Object.entries(sources)) {
    for (const r of db.prepare(sql).all(start, end)) {
      if (!r.uid || !stat[r.uid]) continue;
      stat[r.uid].actions++;
      stat[r.uid].breakdown[label] = (stat[r.uid].breakdown[label] || 0) + 1;
      if (r.d) activeSet.add(r.uid + '|' + r.d);
    }
  }
  // Assigned shifts → covered / missed
  const today = new Date().toISOString().slice(0, 10);
  for (const a of db.prepare(`SELECT a.user_id uid, s.date d FROM assignments a JOIN shifts s ON s.id = a.shift_id WHERE s.date >= ? AND s.date < ?`).all(start, end)) {
    if (!stat[a.uid] || a.d > today) continue;
    stat[a.uid].assigned++;
    if (activeSet.has(a.uid + '|' + a.d)) stat[a.uid].covered++; else stat[a.uid].missed++;
  }
  // Training currency per teammate
  const tcourses = db.prepare(`SELECT id, recert_days FROM courses WHERE active = 1`).all();
  Object.values(stat).forEach((s) => {
    let cur = 0, due = 0;
    tcourses.forEach((c) => { (courseStatus(c, s.id).due ? due++ : cur++); });
    s.trainingCurrent = cur; s.trainingDue = due; s.trainingTotal = tcourses.length;
  });
  const staff = Object.values(stat).sort((x, y) => (x.missed - y.missed) || (y.actions - x.actions));
  const eligible = staff.filter((s) => s.assigned > 0);
  const champion = (eligible.length ? eligible : staff.filter((s) => s.actions > 0)).sort((x, y) => (x.missed - y.missed) || (y.actions - x.actions))[0] || null;

  // House care gaps: active client-days this month (up to today) with no pulse.
  const pulsed = new Set(db.prepare(`SELECT client_id || '|' || date k FROM pulses WHERE date >= ? AND date < ?`).all(start, end).map((r) => r.k));
  const clients = db.prepare(`SELECT id, pref, name, admit FROM clients WHERE active = 1`).all();
  let gapCount = 0; const gaps = [];
  for (const c of clients) {
    let d = new Date(Math.max(new Date(start).getTime(), c.admit ? new Date(c.admit + 'T00:00').getTime() : 0));
    const stop = new Date(Math.min(new Date(end).getTime(), new Date(today + 'T00:00').getTime() + 864e5));
    for (; d < stop; d = new Date(d.getTime() + 864e5)) {
      const ds = d.toISOString().slice(0, 10);
      if (!pulsed.has(c.id + '|' + ds)) { gapCount++; if (gaps.length < 30) gaps.push({ client: c.pref || c.name, date: ds }); }
    }
  }
  res.json({ month, staff, champion, gaps: { count: gapCount, recent: gaps } });
});

/* ---------------- Alumni / continuing care ---------------- */
app.get('/api/alumni', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, pref, name, room, program, sober, discharge_status, discharge_date FROM clients WHERE discharge_status IN ('Completed','AMA') ORDER BY discharge_date DESC`).all();
  const now = Date.now();
  for (const c of rows) {
    c.daysSober = c.sober ? Math.floor((now - new Date(c.sober + 'T00:00').getTime()) / 864e5) : null;
    c.openCalls = db.prepare(`SELECT COUNT(*) n FROM followups WHERE client_id = ? AND status = 'Pending'`).get(c.id).n;
    c.lastTouch = db.prepare(`SELECT created_at FROM alumni_notes WHERE client_id = ? ORDER BY id DESC LIMIT 1`).get(c.id)?.created_at || null;
  }
  res.json({ alumni: rows });
});
app.get('/api/alumni/:id/notes', requireAuth, (req, res) => {
  res.json({ notes: db.prepare(`SELECT * FROM alumni_notes WHERE client_id = ? ORDER BY id DESC LIMIT 50`).all(req.params.id) });
});
app.post('/api/alumni/:id/notes', requireAuth, (req, res) => {
  if (!req.body?.text?.trim()) return res.status(400).json({ error: 'Missing' });
  db.prepare(`INSERT INTO alumni_notes (client_id, text, by_id, by_name) VALUES (?, ?, ?, ?)`).run(req.params.id, req.body.text.trim(), req.user.id, req.user.name);
  res.json({ ok: true });
});

/* ---------------- Client-facing kiosk (no staff login; guarded by a code) ---------------- */
function kioskCode() { return getState('kiosk_code') || process.env.KIOSK_CODE || 'armada'; }
function kioskOk(req) { return (req.query.code || req.body?.code) === kioskCode(); }
app.get('/api/kiosk/data', (req, res) => {
  if (!kioskOk(req)) return res.status(401).json({ error: 'Invalid kiosk code' });
  const surveys = db.prepare(`SELECT id, key, title, description FROM surveys WHERE active = 1 AND key IN ('experience','meals') ORDER BY sort`).all();
  for (const s of surveys) s.questions = db.prepare(`SELECT id, category, text, type FROM survey_questions WHERE survey_id = ? ORDER BY sort, id`).all(s.id);
  res.json({
    clients: db.prepare(`SELECT id, pref, name, room FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all(),
    departments: DEPARTMENTS, surveys,
  });
});
app.post('/api/kiosk/request', (req, res) => {
  if (!kioskOk(req)) return res.status(401).json({ error: 'Invalid kiosk code' });
  const b = req.body || {}; if (!b.text?.trim()) return res.status(400).json({ error: 'Tell us what you need' });
  db.prepare(`INSERT INTO requests (client_id, department, text, priority, created_by_name) VALUES (?, ?, ?, 'Normal', ?)`)
    .run(b.client_id || null, b.department || 'Front Desk / Concierge', b.text.trim(), 'Client (kiosk)');
  res.json({ ok: true });
});
app.post('/api/kiosk/survey', (req, res) => {
  if (!kioskOk(req)) return res.status(401).json({ error: 'Invalid kiosk code' });
  const b = req.body || {};
  const survey = db.prepare(`SELECT id FROM surveys WHERE id = ?`).get(b.survey_id);
  if (!survey || !Array.isArray(b.answers) || !b.answers.length) return res.status(400).json({ error: 'No answers' });
  const info = db.prepare(`INSERT INTO survey_responses (survey_id, client_id) VALUES (?, ?)`).run(survey.id, b.client_id || null);
  const ins = db.prepare(`INSERT INTO survey_answers (response_id, question_id, value_num, value_text) VALUES (?, ?, ?, ?)`);
  for (const a of b.answers) {
    if (a.question_id == null) continue;
    ins.run(info.lastInsertRowid, a.question_id, (a.num === 0 || a.num) ? Number(a.num) : null, a.text?.trim() || null);
  }
  res.json({ ok: true });
});

/* ---------------- SOP / Policy library ---------------- */
app.get('/api/docs', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT id, title, category, tags, body, updated_at FROM docs`;
  const args = [];
  if (q) { sql += ` WHERE title LIKE ? OR body LIKE ? OR category LIKE ? OR IFNULL(tags,'') LIKE ?`; const like = '%' + q + '%'; args.push(like, like, like, like); }
  sql += ` ORDER BY pinned DESC, category, title`;
  const docs = db.prepare(sql).all(...args);
  const reads = new Set(db.prepare(`SELECT doc_id FROM doc_reads WHERE user_id = ?`).all(req.user.id).map((r) => r.doc_id));
  docs.forEach((d) => { d.read = reads.has(d.id); d.excerpt = (d.body || '').slice(0, 160); });
  res.json({ docs });
});
app.post('/api/docs', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {}; if (!b.title?.trim() || !b.body?.trim()) return res.status(400).json({ error: 'Title and body required' });
  if (b.id) db.prepare(`UPDATE docs SET title=?, category=?, body=?, tags=?, updated_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.title.trim(), b.category || 'SOP', b.body.trim(), b.tags || null, req.user.name, b.id);
  else db.prepare(`INSERT INTO docs (title, category, body, tags, updated_by) VALUES (?, ?, ?, ?, ?)`)
    .run(b.title.trim(), b.category || 'SOP', b.body.trim(), b.tags || null, req.user.name);
  res.json({ ok: true });
});
app.delete('/api/docs/:id', requireAuth, requireAdmin, (req, res) => { db.prepare(`DELETE FROM docs WHERE id = ?`).run(req.params.id); res.json({ ok: true }); });
app.post('/api/docs/:id/read', requireAuth, (req, res) => {
  db.prepare(`INSERT OR IGNORE INTO doc_reads (doc_id, user_id) VALUES (?, ?)`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------------- Training ---------------- */
function courseStatus(course, userId) {
  const last = db.prepare(`SELECT * FROM course_completions WHERE course_id = ? AND user_id = ? AND passed = 1 ORDER BY id DESC LIMIT 1`).get(course.id, userId);
  let due = !last;
  if (last && course.recert_days > 0) due = (Date.now() - new Date(last.completed_at + 'Z').getTime()) > course.recert_days * 864e5;
  return { lastPassed: last ? { score: last.score, at: last.completed_at } : null, due };
}
app.get('/api/courses', requireAuth, (req, res) => {
  const courses = db.prepare(`SELECT id, title, description, recert_days FROM courses WHERE active = 1 ORDER BY sort, id`).all();
  courses.forEach((c) => { c.questionCount = db.prepare(`SELECT COUNT(*) n FROM course_questions WHERE course_id = ?`).get(c.id).n; Object.assign(c, courseStatus(c, req.user.id)); });
  res.json({ courses });
});
app.get('/api/courses/:id', requireAuth, (req, res) => {
  const c = db.prepare(`SELECT id, title, description, body, recert_days FROM courses WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.questions = db.prepare(`SELECT id, text, options FROM course_questions WHERE course_id = ? ORDER BY sort, id`).all(c.id)
    .map((q) => ({ id: q.id, text: q.text, options: JSON.parse(q.options) }));  // answers withheld
  res.json({ course: c });
});
app.post('/api/courses/:id/complete', requireAuth, (req, res) => {
  const c = db.prepare(`SELECT * FROM courses WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const qs = db.prepare(`SELECT id, answer FROM course_questions WHERE course_id = ? ORDER BY sort, id`).all(c.id);
  const ans = req.body?.answers || {};
  let correct = 0;
  const review = qs.map((q) => { const ok = Number(ans[q.id]) === q.answer; if (ok) correct++; return { id: q.id, correct: ok, answer: q.answer }; });
  const score = qs.length ? Math.round((correct / qs.length) * 100) : 100;
  const passed = score >= 80 ? 1 : 0;
  db.prepare(`INSERT INTO course_completions (course_id, user_id, user_name, score, passed) VALUES (?, ?, ?, ?, ?)`).run(c.id, req.user.id, req.user.name, score, passed);
  audit({ user: req.user, action: 'TRAINING', entity: 'course', entity_id: c.id, detail: `${c.title}: ${score}%`, ip: req.ip });
  res.json({ score, passed: !!passed, review });
});
app.post('/api/courses', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {}; if (!b.title?.trim() || !Array.isArray(b.questions)) return res.status(400).json({ error: 'Missing' });
  const info = db.prepare(`INSERT INTO courses (title, description, body, recert_days) VALUES (?, ?, ?, ?)`).run(b.title.trim(), b.description || null, b.body || null, Number(b.recert_days) || 0);
  const ins = db.prepare(`INSERT INTO course_questions (course_id, text, options, answer, sort) VALUES (?, ?, ?, ?, ?)`);
  b.questions.forEach((q, i) => { if (q.q && Array.isArray(q.o)) ins.run(info.lastInsertRowid, q.q, JSON.stringify(q.o), Number(q.a) || 0, i); });
  res.json({ ok: true });
});
// Admin: team training status
app.get('/api/training-status', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT id, name FROM users WHERE active = 1 ORDER BY name`).all();
  const courses = db.prepare(`SELECT id, title, recert_days FROM courses WHERE active = 1 ORDER BY sort, id`).all();
  const rows = users.map((u) => ({ name: u.name, courses: courses.map((c) => ({ title: c.title, ...courseStatus(c, u.id) })) }));
  res.json({ courses: courses.map((c) => c.title), rows });
});

/* ---------------- Daily focus / refresher ---------------- */
function focusForDate(dateStr) {
  const o = getState('focus:' + dateStr);
  if (o) { try { return JSON.parse(o); } catch (e) { /* fall through */ } }
  const idx = Math.floor(new Date(dateStr + 'T00:00').getTime() / 864e5) % FOCUS_TOPICS.length;
  return FOCUS_TOPICS[idx];
}
app.get('/api/focus', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const f = focusForDate(today);
  const logs = db.prepare(`SELECT user_name, note FROM focus_logs WHERE date = ? ORDER BY id DESC`).all(today);
  res.json({ topic: f.t, goal: f.g, participants: logs.length, logs, joined: !!db.prepare(`SELECT 1 FROM focus_logs WHERE date = ? AND user_id = ?`).get(today, req.user.id), options: FOCUS_TOPICS });
});
app.post('/api/focus', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO focus_logs (date, topic, user_id, user_name, note) VALUES (?, ?, ?, ?, ?)`).run(today, focusForDate(today).t, req.user.id, req.user.name, req.body?.note || null);
  res.json({ ok: true });
});
app.post('/api/focus/set', requireAuth, requireAdmin, (req, res) => {
  const { t, g } = req.body || {}; if (!t?.trim()) return res.status(400).json({ error: 'Missing topic' });
  setState('focus:' + new Date().toISOString().slice(0, 10), JSON.stringify({ t: t.trim(), g: (g || '').trim() }));
  res.json({ ok: true });
});
app.get('/api/focus/history', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT date, COUNT(DISTINCT user_id) n FROM focus_logs WHERE date >= date('now','-21 day') GROUP BY date ORDER BY date DESC`).all();
  rows.forEach((r) => { r.topic = focusForDate(r.date).t; });
  res.json({ history: rows });
});

/* ---------------- Documentation notes + red-flag scanner ---------------- */
// Store a note, scan it for red flags, and raise an alert if follow-up is needed.
async function ingestNote({ client_id, text, author, source }, user, ip) {
  const c = client_id ? db.prepare(`SELECT id, pref, name FROM clients WHERE id = ?`).get(client_id) : null;
  let scan = { flagged: 0, level: 'None', categories: [], summary: null, suggested_action: null };
  if (claudeConfigured()) {
    try { const r = await scanNote(text, c ? (c.pref || c.name) : ''); scan = { flagged: r.flagged ? 1 : 0, level: r.level, categories: r.categories, summary: r.summary, suggested_action: r.suggested_action }; }
    catch (e) { /* store unscanned */ }
  }
  const info = db.prepare(`INSERT INTO notes (client_id, text, author, source, flagged, flag_level, flag_summary, categories, suggested_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(client_id || null, text, author || null, source || 'manual', scan.flagged, scan.level, scan.summary, JSON.stringify(scan.categories), scan.suggested_action);
  if (scan.flagged && (scan.level === 'High' || scan.level === 'Elevated')) {
    createAlert(client_id || null, 'note', scan.level, `${c ? (c.pref || c.name) + ' — ' : ''}note red flag: ${scan.summary || ''}${scan.suggested_action ? ' → ' + scan.suggested_action : ''}`);
  }
  if (user) audit({ user, action: 'NOTE', entity: 'client', entity_id: client_id ? +client_id : null, detail: scan.level, ip });
  return { id: info.lastInsertRowid, ...scan };
}
app.post('/api/notes', requireAuth, async (req, res) => {
  const b = req.body || {}; if (!b.text?.trim()) return res.status(400).json({ error: 'Empty note' });
  try { res.json(await ingestNote({ client_id: b.client_id, text: b.text.trim(), author: req.user.name, source: 'manual' }, req.user, req.ip)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/clients/:id/notes', requireAuth, (req, res) => {
  res.json({ notes: db.prepare(`SELECT * FROM notes WHERE client_id = ? ORDER BY id DESC LIMIT 30`).all(req.params.id).map((n) => ({ ...n, categories: safeArr(n.categories) })) });
});
app.get('/api/notes/flagged', requireAuth, (req, res) => {
  res.json({ notes: db.prepare(`SELECT n.*, c.pref FROM notes n LEFT JOIN clients c ON c.id = n.client_id WHERE n.flagged = 1 ORDER BY n.id DESC LIMIT 50`).all().map((n) => ({ ...n, categories: safeArr(n.categories) })) });
});
// Ingest hook for the EMR/Kipu (no session; guarded by INGEST_KEY). Maps by client_id or name.
app.post('/api/ingest/note', async (req, res) => {
  if (!process.env.INGEST_KEY || (req.headers['x-ingest-key'] !== process.env.INGEST_KEY)) return res.status(401).json({ error: 'Invalid ingest key' });
  const b = req.body || {}; if (!b.text?.trim()) return res.status(400).json({ error: 'Empty note' });
  let cid = b.client_id || null;
  if (!cid && b.client_name) cid = db.prepare(`SELECT id FROM clients WHERE active = 1 AND (pref = ? OR name = ?) ORDER BY id DESC LIMIT 1`).get(b.client_name, b.client_name)?.id || null;
  try { res.json(await ingestNote({ client_id: cid, text: b.text.trim(), author: b.author || 'EMR', source: b.source || 'kipu' }, null, req.ip)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Break-room display (code-gated, no PHI) ---------------- */
app.get('/api/display/data', (req, res) => {
  if (!kioskOk(req)) return res.status(401).json({ error: 'Invalid code' });
  const f = focusForDate(new Date().toISOString().slice(0, 10));
  const month = new Date().toISOString().slice(0, 7);
  // Care Champion (most care actions this month) — name only, no client data
  const champ = db.prepare(`SELECT user_name, COUNT(*) n FROM (
      SELECT user_name FROM (SELECT u.name user_name, p.id FROM pulses p JOIN users u ON u.id=p.author_id WHERE p.date >= ?)
      UNION ALL SELECT by_name FROM delights WHERE created_at >= ? AND by_name IS NOT NULL
      UNION ALL SELECT by_name FROM wows WHERE created_at >= ? AND by_name IS NOT NULL
    ) GROUP BY user_name ORDER BY n DESC LIMIT 1`).get(month + '-01', month + '-01', month + '-01');
  res.json({
    motto: MOTTO, tagline: TAGLINE,
    focus: f,
    wows: db.prepare(`SELECT text, by_name FROM wows ORDER BY id DESC LIMIT 8`).all(),     // staff recognition; no client names shown
    delights: db.prepare(`SELECT text FROM delights ORDER BY id DESC LIMIT 8`).all(),
    champion: champ ? champ.user_name : null,
    counts: {
      delightsWeek: db.prepare(`SELECT COUNT(*) n FROM delights WHERE created_at >= datetime('now','-7 day')`).get().n,
      kudosWeek: db.prepare(`SELECT COUNT(*) n FROM kudos WHERE created_at >= datetime('now','-7 day')`).get().n,
      focusJoined: db.prepare(`SELECT COUNT(DISTINCT user_id) n FROM focus_logs WHERE date = ?`).get(new Date().toISOString().slice(0, 10)).n,
    },
  });
});

/* ---------------- The Save tracker ---------------- */
app.get('/api/saves', requireAuth, (req, res) => {
  res.json({ saves: db.prepare(`SELECT s.*, c.pref FROM saves s LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.id DESC LIMIT 50`).all() });
});
app.post('/api/saves', requireAuth, (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO saves (client_id, trigger, note, outcome, by_id, by_name) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(b.client_id || null, b.trigger || null, b.note || null, ['Stayed', 'Left'].includes(b.outcome) ? b.outcome : 'Pending', req.user.id, req.user.name);
  audit({ user: req.user, action: 'SAVE', entity: 'client', entity_id: b.client_id ? +b.client_id : null, ip: req.ip });
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.post('/api/saves/:id/outcome', requireAuth, (req, res) => {
  const o = ['Stayed', 'Left', 'Pending'].includes(req.body?.outcome) ? req.body.outcome : 'Pending';
  db.prepare(`UPDATE saves SET outcome = ? WHERE id = ?`).run(o, req.params.id);
  res.json({ ok: true });
});
app.post('/api/lineup-log', requireAuth, (req, res) => {
  db.prepare(`INSERT OR IGNORE INTO lineup_log (date, shift, by_id) VALUES (?, ?, ?)`).run(new Date().toISOString().slice(0, 10), req.body?.shift || 'Day', req.user.id);
  res.json({ ok: true });
});

/* ---------------- Excellence Scorecard (Standard §22) ---------------- */
app.get('/api/scorecard', requireAuth, (req, res) => {
  const m = [];
  const push = (label, value, unit, target, met, note) => m.push({ label, value, unit, target, met, note });
  const disc = db.prepare(`SELECT discharge_status s, COUNT(*) n FROM clients WHERE discharge_date >= date('now','-90 day') GROUP BY discharge_status`).all();
  const dc = {}; disc.forEach((r) => { dc[r.s] = r.n; });
  const completed = dc.Completed || 0, ama = dc.AMA || 0; const denom = completed + ama;
  push('AMA rate (90d)', denom ? Math.round(ama / denom * 100) : 0, '%', '↓ lower', denom ? (ama / denom) <= 0.2 : true, `${ama} of ${denom} discharges`);
  push('Completion rate (90d)', denom ? Math.round(completed / denom * 100) : 0, '%', '≥ 70%', denom ? (completed / denom) >= 0.7 : true, '');
  const ce = db.prepare(`SELECT cared FROM client_experience WHERE created_at >= datetime('now','-30 day')`).all();
  const sv = db.prepare(`SELECT a.value_num v FROM survey_answers a JOIN survey_questions q ON q.id=a.question_id JOIN survey_responses r ON r.id=a.response_id WHERE q.text LIKE 'I feel genuinely cared for%' AND r.created_at >= datetime('now','-30 day')`).all();
  const all = [...ce.map((x) => x.cared), ...sv.map((x) => x.v)].filter((x) => x != null);
  const topbox = all.length ? Math.round(all.filter((x) => x >= 4).length / all.length * 100) : null;
  push('"I felt cared for" top-box (30d)', topbox == null ? '—' : topbox, '%', '≥ 90%', topbox == null ? null : topbox >= 90, `${all.length} responses`);
  const sret = db.prepare(`SELECT outcome, COUNT(*) n FROM saves WHERE outcome != 'Pending' GROUP BY outcome`).all();
  const sgc = {}; sret.forEach((r) => { sgc[r.outcome] = r.n; }); const sden = (sgc.Stayed || 0) + (sgc.Left || 0);
  push('Save success rate', sden ? Math.round((sgc.Stayed || 0) / sden * 100) : '—', '%', '↑ higher', sden ? (sgc.Stayed / sden) >= 0.5 : null, `${sgc.Stayed || 0} stayed of ${sden}`);
  const deps = db.prepare(`SELECT departure_steps FROM clients WHERE discharge_status IN ('Completed','AMA') AND discharge_date >= date('now','-90 day')`).all();
  const nal = deps.filter((d) => (d.departure_steps || '').toLowerCase().includes('naloxone')).length;
  push('Naloxone-at-departure (90d)', deps.length ? Math.round(nal / deps.length * 100) : '—', '%', '100%', deps.length ? nal === deps.length : null, `${nal} of ${deps.length}`);
  const lc = db.prepare(`SELECT COUNT(*) n FROM lineup_log WHERE date >= date('now','-7 day')`).get().n;
  push('Lineup compliance (7d)', Math.round(lc / 28 * 100), '%', '100%', lc >= 28, `${lc} of 28 logged`);
  const cl = db.prepare(`SELECT (julianday(resolved_at)-julianday(created_at))*24 h FROM concerns WHERE resolved_at >= datetime('now','-30 day')`).all();
  const avgH = cl.length ? Math.round(cl.reduce((a, b) => a + b.h, 0) / cl.length * 10) / 10 : null;
  push('Avg defect closure (30d)', avgH == null ? '—' : avgH, 'hrs', '≤ 24', avgH == null ? null : avgH <= 24, `${cl.length} resolved`);
  push('Delights delivered (30d)', db.prepare(`SELECT COUNT(*) n FROM delights WHERE created_at >= datetime('now','-30 day')`).get().n, '', '↑ more', true, '');
  res.json({ metrics: m });
});

/* ---------------- The Armada Standard (knowledge base) ---------------- */
app.get('/api/standard', requireAuth, (req, res) => {
  res.json({ northStar: NORTH_STAR, motto: MOTTO, tagline: TAGLINE, sections: STANDARD_SECTIONS });
});

// Crisis Owner for a shift (named on the lineup board, per the Standard).
app.post('/api/crisis-owner', requireAuth, (req, res) => {
  const { date, shift, user_id } = req.body || {};
  const s = getOrCreateShift(date || new Date().toISOString().slice(0, 10), SHIFTS.includes(shift) ? shift : 'Morning');
  const u = user_id ? db.prepare(`SELECT name FROM users WHERE id = ?`).get(user_id) : null;
  db.prepare(`UPDATE shifts SET crisis_owner_id = ?, crisis_owner_name = ? WHERE id = ?`).run(user_id || null, u?.name || null, s.id);
  res.json({ ok: true });
});

/* ---------------- static ---------------- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Armada Care Standards running on http://localhost:${PORT}`));

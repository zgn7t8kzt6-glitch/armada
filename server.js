// Armada Care Standards — multi-user server
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, audit, getState, setState } from './src/db.js';
import { buildWeeklyData, renderReportHtml, sendWeeklyReport, emailConfigured, emailStatus, surveyMetrics, sendEmail, sendSms, smsConfigured, smsStatus } from './src/report.js';
import { STANDARD_SECTIONS, NORTH_STAR, MOTTO, TAGLINE } from './src/standard.js';
import { todaysFocus, FOCUS_TOPICS } from './src/db.js';
import { REFERRAL_DEPARTMENTS, REFERRAL_CATEGORIES, REFERRAL_REASONS, FACILITY_TYPES, DISCHARGE_TYPES, CASE_CATEGORIES, DIRECTOR_REVIEW } from './src/db.js';
import { ASAM_LEVELS, LOC_RANK, LOC_LABEL, parseLoc, rollupDailyMetrics, appToday, addDays, APP_TZ } from './src/db.js';
import { kipuConfigured, kipuTest, kipuSyncRoster, kipuInspect, kipuPatientNotes, kipuDocInspect, kipuPatientChart, kipuEvaluation, kipuPatientExtras, kipuReconcile, kipuFindRounds, kipuClientRounds, kipuFixDischargeDates } from './src/kipu.js';
import { sfConfigured, sfTest, sfSyncInbound, sfStatus, sfDiscover, sfDescribe, sfAutomap, sfSyncArrivals } from './src/salesforce.js';
import { whConfigured, whTest, whColumns, whSyncRoster, whSyncNotes } from './src/warehouse.js';
import {
  cookies, login, logout, completeMfa, currentUser, requireAuth, requireAdmin, createUser, changePassword,
  mfaSetup, mfaEnable, mfaDisable,
} from './src/auth.js';
import { ensureAdmin, ensureSampleData, ensureExampleClient12A } from './src/seed.js';
import { generateShiftTasks, generateAmaRead, generateCareBrief, generateShiftBriefing, askAssistant, scanNote, claudeConfigured, AMA_TRIGGERS, DEID, scrub, aiHealth, aiProvider, generateReferralInsights, generateOutcomeInsights, generateDischargeDebrief, generateIssueDigest, generateWelcomePlan, generateAftercarePlan } from './src/claude.js';

// On boot, make sure there's an admin to log in with (reads ADMIN_USER / ADMIN_PASS).
// Optionally load demo data when SEED_SAMPLE=true (handy for a pilot).
ensureAdmin();
if (process.env.SEED_SAMPLE === 'true') ensureSampleData();
ensureExampleClient12A();
// Default census recipient so a test send reaches the right person out of the box.
if (!getState('census_email_to')) setState('census_email_to', process.env.CENSUS_EMAIL_TO || 'shlomo@armadarecovery.com');
// One-time cleanup on boot: clear stale auto-generated risk/concern alerts (e.g.
// the early contaminated batch). The scheduled assessment regenerates clean ones.
try { db.prepare(`DELETE FROM alerts WHERE kind IN ('risk', 'concern') AND status = 'New'`).run(); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));   // 1mb headroom for client-resized photo uploads
app.use(cookies);

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// CSRF defense: reject state-changing requests whose Origin (or Referer) is a
// DIFFERENT host than ours. Same-origin XHR sends a matching Origin; cross-site
// form/fetch attacks send the attacker's. Requests with no Origin/Referer
// (server-to-server, curl) are allowed — they aren't browser CSRF.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked' });
  } catch { return res.status(403).json({ error: 'Bad origin' }); }
  next();
});

const SHIFTS = ['Morning', 'Day', 'Evening', 'Night'];
const JOB_ROLES = ['BHT / Tech', 'Nurse', 'Therapist', 'Case Manager', 'Front Desk', 'Kitchen', 'Housekeeping'];
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

const chartCache = new Map();   // kipu_id|all -> { at, data }; 90s TTL

// ---- Medical send-outs (ED/hospital) — the census "OTHER" section ----
app.get('/api/sendouts', requireAuth, (req, res) => {
  const out = db.prepare(`SELECT * FROM medical_sendouts WHERE status = 'out' ORDER BY sent_at DESC`).all();
  const recent = db.prepare(`SELECT * FROM medical_sendouts WHERE status != 'out' AND sent_at >= datetime('now','-7 day') ORDER BY sent_at DESC LIMIT 30`).all();
  res.json({ out, recent });
});
app.post('/api/sendouts', requireAuth, (req, res) => {
  const b = req.body || {};
  let name = (b.client_name || '').trim();
  if (b.client_id) { const c = db.prepare(`SELECT pref, name FROM clients WHERE id = ?`).get(b.client_id); if (c) name = c.pref || c.name; }
  if (!name) return res.status(400).json({ error: 'Client name required' });
  const info = db.prepare(`INSERT INTO medical_sendouts (client_id, client_name, destination, reason, sent_by) VALUES (?,?,?,?,?)`)
    .run(b.client_id || null, name, (b.destination || '').trim() || null, (b.reason || '').trim() || null, req.user.name);
  audit({ user: req.user, action: 'SENDOUT', entity: 'client', entity_id: b.client_id || null, detail: name, ip: req.ip });
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/sendouts/:id/close', requireAuth, (req, res) => {
  const status = ['returned', 'admitted_elsewhere'].includes(req.body?.status) ? req.body.status : 'returned';
  db.prepare(`UPDATE medical_sendouts SET status = ?, returned_at = datetime('now'), returned_by = ?, note = COALESCE(?, note) WHERE id = ?`)
    .run(status, req.user.name, req.body?.note || null, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/sendouts/:id', requireAuth, (req, res) => { db.prepare(`DELETE FROM medical_sendouts WHERE id = ?`).run(req.params.id); res.json({ ok: true }); });

// ---- Observation / safety rounds: prove every client is being checked ----
const OBS_DEFAULT_MIN = +(process.env.OBS_DEFAULT_MIN || 60);
const OBS_STATUSES = ['ok', 'asleep', 'concern', 'refused', 'off-unit'];
app.get('/api/rounds/board', requireAuth, (req, res) => {
  const active = db.prepare(`SELECT id, pref, name, room, loc, photo, obs_interval FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const lastChk = db.prepare(`SELECT ts, by_name, status FROM obs_checks WHERE client_id = ? ORDER BY id DESC LIMIT 1`);
  const now = Date.now();
  const rows = active.map((c) => {
    const l = lastChk.get(c.id);
    const interval = c.obs_interval || OBS_DEFAULT_MIN;
    const lastTs = l ? Date.parse(String(l.ts).replace(' ', 'T') + 'Z') : null;
    const mins = lastTs ? Math.floor((now - lastTs) / 60000) : null;
    return { id: c.id, name: c.pref || c.name, room: c.room, photo: c.photo || null, interval,
      lastBy: l?.by_name || null, lastStatus: l?.status || null, minsSince: mins, overdue: mins == null || mins >= interval };
  });
  const overdue = rows.filter((r) => r.overdue).length;
  // Accountability: checks logged today, by person.
  const byPerson = db.prepare(`SELECT COALESCE(by_name,'—') k, COUNT(*) n FROM obs_checks WHERE date(ts) = date('now') GROUP BY by_name ORDER BY n DESC`).all();
  res.json({ rows, total: rows.length, onTime: rows.length - overdue, overdue, defaultMin: OBS_DEFAULT_MIN, statuses: OBS_STATUSES, byPerson });
});
app.post('/api/rounds/check', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.client_id) return res.status(400).json({ error: 'client_id required' });
  const status = OBS_STATUSES.includes(b.status) ? b.status : 'ok';
  db.prepare(`INSERT INTO obs_checks (client_id, status, note, by_name) VALUES (?,?,?,?)`).run(+b.client_id, status, (b.note || '').trim() || null, req.user.name);
  if (status === 'concern') createAlert(+b.client_id, 'concern', 'Elevated', `Safety-round concern logged by ${req.user.name}`);
  res.json({ ok: true });
});
// "I walked the whole unit" — log a check for every active client at once.
app.post('/api/rounds/sweep', requireAuth, (req, res) => {
  const active = db.prepare(`SELECT id FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const ins = db.prepare(`INSERT INTO obs_checks (client_id, status, by_name) VALUES (?, 'ok', ?)`);
  db.exec('BEGIN');
  try { for (const c of active) ins.run(c.id, req.user.name); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); return res.status(500).json({ error: e.message }); }
  audit({ user: req.user, action: 'ROUNDS_SWEEP', detail: `${active.length} clients`, ip: req.ip });
  res.json({ ok: true, checked: active.length });
});
app.put('/api/clients/:id/obs-interval', requireAuth, (req, res) => {
  const v = +req.body?.minutes || null;
  db.prepare(`UPDATE clients SET obs_interval = ? WHERE id = ?`).run(v && v > 0 ? v : null, req.params.id);
  res.json({ ok: true });
});
app.get('/api/rounds/escalation', requireAuth, requireAdmin, (req, res) => res.json({ on: getState('rounds_escalation') === 'on', smsReady: smsConfigured() }));
app.post('/api/rounds/escalation', requireAuth, requireAdmin, (req, res) => { setState('rounds_escalation', req.body?.on ? 'on' : 'off'); res.json({ ok: true }); });

// Owner-level accountability: per therapist / case manager — caseload, chart
// completeness, care-card completion, and outcomes (AMA rate, avg LOS).
app.get('/api/accountability/owners', requireAuth, requireAdmin, (req, res) => {
  const active = db.prepare(`SELECT id, therapist, case_manager, loc, diagnosis, insurance, touch, prefs, anchor_why, doc_forms FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const chartComplete = (c) => { let f = {}; try { f = c.doc_forms ? JSON.parse(c.doc_forms) : {}; } catch { f = {}; } return !!(c.loc && c.loc !== 'Unspecified') && !!c.diagnosis && !!c.insurance && !!f.biopsych && !!f.tx_plan; };
  const ccComplete = (c) => !!(c.touch && c.prefs && c.anchor_why);
  const agg = (field) => {
    const m = {};
    for (const c of active) { const who = (c[field] || '').trim(); if (!who) continue; const e = m[who] || (m[who] = { owner: who, caseload: 0, chart: 0, cc: 0 }); e.caseload++; if (chartComplete(c)) e.chart++; if (ccComplete(c)) e.cc++; }
    return Object.values(m).map((e) => ({ ...e, chartPct: Math.round(e.chart / e.caseload * 100), ccPct: Math.round(e.cc / e.caseload * 100) })).sort((a, b) => a.chartPct - b.chartPct);
  };
  const a = buildAnalytics(90);
  const oT = {}, oC = {};
  for (const t of a.byTherapist) oT[t.key] = t;
  for (const t of a.byCaseManager) oC[t.key] = t;
  const merge = (rows, outc) => rows.map((e) => ({ ...e, amaRate: outc[e.owner]?.amaRate ?? null, avgLos: outc[e.owner]?.avgLos ?? null, discharges: outc[e.owner]?.n ?? 0 }));
  res.json({ caseload: active.length, unassignedTherapist: active.filter((c) => !c.therapist).length, unassignedCM: active.filter((c) => !c.case_manager).length, byTherapist: merge(agg('therapist'), oT), byCaseManager: merge(agg('case_manager'), oC) });
});

// ---- Care Card completion: the hospitality layer ON TOP of the Kipu chart.
// Every new admit must have it filled within the first hour so we can care for
// them by their preferences right away. (Identity comes from Kipu — single
// source of truth; staff fill the preferences.) ----
const CARECARD_CORE = [
  { key: 'touch', label: 'Personal touch' },
  { key: 'prefs', label: 'Preferences' },
  { key: 'anchor_why', label: 'Intake anchor (why they came)' },
];
const CARECARD_DUE_MIN = +(process.env.CARECARD_DUE_MIN || 60);
function careCardStatus(c) {
  const missing = CARECARD_CORE.filter((f) => !(c[f.key] && String(c[f.key]).trim())).map((f) => f.label);
  return { complete: missing.length === 0, missing };
}
function careCardMinsSinceAdmit(c) {
  if (!c.admit) return null;
  const ts = Date.parse(String(c.admit).slice(0, 10) + 'T' + (c.admit_time && /^\d{2}:\d{2}/.test(c.admit_time) ? c.admit_time.slice(0, 5) : '00:00') + ':00');
  return Number.isNaN(ts) ? null : Math.floor((Date.now() - ts) / 60000);
}
app.get('/api/carecards', requireAuth, (req, res) => {
  const active = db.prepare(`SELECT id, pref, name, room, program, loc, admit, admit_time, touch, prefs, anchor_why, goals, triggers, safety FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY admit DESC, room`).all();
  const rows = active.map((c) => {
    const st = careCardStatus(c);
    const mins = careCardMinsSinceAdmit(c);
    return { id: c.id, name: c.pref || c.name, room: c.room, loc: c.loc, admit: c.admit, minsSinceAdmit: mins,
      complete: st.complete, missing: st.missing, overdue: !st.complete && mins != null && mins > CARECARD_DUE_MIN };
  });
  res.json({
    dueMin: CARECARD_DUE_MIN, total: rows.length,
    complete: rows.filter((r) => r.complete).length,
    incomplete: rows.filter((r) => !r.complete),
    overdue: rows.filter((r) => r.overdue).length,
  });
});

// ---- Documentation compliance: % of required Kipu fields completed, per SLA,
// with the overdue clients named. Turns "is the chart complete?" into a score. ----
const DOC_REQS = [
  { key: 'loc', label: 'Level of care (ASAM)', slaHrs: 1, has: (c) => c.loc && c.loc !== 'Unspecified' },
  { key: 'diagnosis', label: 'Diagnosis', slaHrs: 24, has: (c) => !!c.diagnosis },
  { key: 'insurance', label: 'Insurance', slaHrs: 24, has: (c) => !!c.insurance },
  { key: 'therapist', label: 'Primary therapist', slaHrs: 24, has: (c) => !!c.therapist },
  { key: 'case_manager', label: 'Case manager', slaHrs: 24, has: (c) => !!c.case_manager },
  { key: 'referral_source', label: 'Referral source', slaHrs: 24, has: (c) => !!c.referral_source },
  // These are verified by the ACTUAL Kipu chart form (doc_forms), not inferred.
  { key: 'biopsych', label: 'Biopsychosocial', slaHrs: 24, form: 'biopsych' },
  { key: 'tx_plan', label: 'Treatment plan', slaHrs: 72, form: 'tx_plan' },
  { key: 'asam', label: 'ASAM / level-of-care assessment', slaHrs: 72, form: 'asam' },
  { key: 'cm_note', label: 'Case-management note', slaHrs: 24, form: 'cm_note' },
];
app.get('/api/compliance', requireAuth, requireAdmin, (req, res) => {
  const clients = db.prepare(`SELECT id, pref, name, room, admit, admit_time, loc, diagnosis, insurance, therapist, case_manager, referral_source, doc_forms FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const formsByClient = {};
  for (const c of clients) { try { formsByClient[c.id] = c.doc_forms ? JSON.parse(c.doc_forms) : null; } catch { formsByClient[c.id] = null; } }
  const out = DOC_REQS.map((rq) => {
    let complete = 0, applicable = 0; const overdue = [], missing = [];
    for (const c of clients) {
      let ok;
      if (rq.form) { const f = formsByClient[c.id]; if (f == null) continue; applicable++; ok = !!f[rq.form]; }   // chart-verified
      else { applicable++; ok = !!rq.has(c); }
      if (ok) { complete++; continue; }
      const m = careCardMinsSinceAdmit(c);
      const row = { id: c.id, name: c.pref || c.name, room: c.room, mins: m };
      missing.push(row);
      if (m == null || m > rq.slaHrs * 60) overdue.push(row);
    }
    return { key: rq.key, label: rq.label, slaHrs: rq.slaHrs, complete, total: applicable, pct: applicable ? Math.round(complete / applicable * 100) : null, overdueCount: overdue.length, overdue: overdue.slice(0, 30), missing: missing.slice(0, 30) };
  });
  const totC = out.reduce((s, r) => s + r.complete, 0), totT = out.reduce((s, r) => s + r.total, 0);
  res.json({ clients: clients.length, score: totT ? Math.round(totC / totT * 100) : null, fields: out });
});

// Build the nightly census (the in-app equal of the manual email) as HTML+text.
function buildCensusReport() {
  const today = appToday();
  const active = db.prepare(`SELECT id, pref, name, program, loc, admit FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const byLoc = {};
  for (const c of active) { const k = (c.loc && c.loc !== 'Unspecified') ? c.loc : (parseLoc(c.program) || 'Unspecified'); byLoc[k] = (byLoc[k] || 0) + 1; }
  const rows = Object.entries(byLoc).map(([code, n]) => ({ code, label: LOC_LABEL[code] || code, n })).sort((a, b) => (LOC_RANK[b.code] ?? -1) - (LOC_RANK[a.code] ?? -1));
  const intakes = active.filter((c) => (c.admit || '').slice(0, 10) === today).map((c) => c.pref || c.name);
  const dcs = db.prepare(`SELECT pref, name, discharge_status, discharge_reason FROM clients WHERE substr(discharge_date,1,10) = ?`).all(today);
  const sendouts = db.prepare(`SELECT client_name, destination, reason FROM medical_sendouts WHERE status = 'out'`).all();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const html = `<div style="font-family:Georgia,serif;color:#1b2825;max-width:560px">
    <h2 style="font-family:Georgia,serif">Midnight Census — ${today}</h2>
    ${rows.map((r) => `<div><strong>${esc(r.code)}</strong> ${esc(r.label.replace(r.code + ' · ', ''))} — <strong>${r.n}</strong></div>`).join('')}
    <div style="border-top:2px solid #ccc;margin-top:6px;padding-top:6px"><strong>TOTAL CENSUS — ${active.length}</strong></div>
    <h3>Intakes</h3>${intakes.length ? intakes.map((n) => `<div>• ${esc(n)}</div>`).join('') : '<div>ZERO</div>'}
    <h3>Discharges</h3>${dcs.length ? dcs.map((d) => `<div>• ${esc(d.pref || d.name)} — ${esc(d.discharge_status || '')}${d.discharge_reason ? ' · ' + esc(d.discharge_reason) : ''}</div>`).join('') : '<div>ZERO</div>'}
    ${sendouts.length ? `<h3>Other (medical send-outs)</h3>${sendouts.map((s) => `<div>• ${esc(s.client_name)} — ${esc(s.destination || 'sent out')}${s.reason ? ': ' + esc(s.reason) : ''}</div>`).join('')}` : ''}
    <p style="color:#888;font-size:12px">Generated by Armada Care Standards.</p></div>`;
  const text = `Midnight Census — ${today}\n` + rows.map((r) => `${r.code}: ${r.n}`).join('\n') + `\nTOTAL: ${active.length}\nIntakes: ${intakes.join(', ') || 'ZERO'}\nDischarges: ${dcs.map((d) => (d.pref || d.name) + ' — ' + (d.discharge_status || '')).join('; ') || 'ZERO'}`;
  return { subject: `Midnight Census — ${today} (${active.length})`, html, text, total: active.length };
}
async function sendCensusEmail() {
  const to = (getState('census_email_to') || process.env.CENSUS_EMAIL_TO || process.env.REPORT_TO || '').trim();
  if (!emailConfigured()) return { sent: false, reason: 'email not connected — Settings → Email' };
  if (!to) return { sent: false, reason: 'no recipients set — add them under Recipients…' };
  const r = buildCensusReport();
  await sendEmail({ to, subject: r.subject, html: r.html });
  return { sent: true, to };
}
app.post('/api/command/census/email', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await sendCensusEmail(); res.json(r); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/command/census/recipients', requireAuth, requireAdmin, (req, res) => res.json({ to: getState('census_email_to') || '', emailReady: emailConfigured() }));
app.post('/api/command/census/recipients', requireAuth, requireAdmin, (req, res) => { setState('census_email_to', (req.body?.to || '').trim()); res.json({ ok: true }); });
app.post('/api/command/brief', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await sendMorningBrief()); } catch (e) { res.status(502).json({ error: e.message }); }
});

// ---- Email setup (in-app, no Render env editing). Secrets stored server-side;
// never returned to the client. ----
app.get('/api/email/config', requireAuth, requireAdmin, (req, res) => {
  const st = emailStatus();
  res.json({ ...st, hasResendKey: !!(getState('email_resend_key') || process.env.RESEND_API_KEY), hasSmtpPass: !!(getState('email_smtp_pass') || process.env.SMTP_PASS),
    smtpPort: getState('email_smtp_port') || process.env.SMTP_PORT || '587', to: getState('email_to') || getState('census_email_to') || process.env.CENSUS_EMAIL_TO || '' });
});
app.post('/api/email/config', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const set = (k, v) => { if (v !== undefined) setState('email_' + k, (v == null ? '' : String(v)).trim()); };
  set('provider', b.provider); set('from', b.from); set('to', b.to);
  set('smtp_host', b.smtp_host); set('smtp_port', b.smtp_port); set('smtp_user', b.smtp_user);
  if (b.smtp_pass) set('smtp_pass', b.smtp_pass);              // only overwrite if provided
  if (b.resend_key) set('resend_key', b.resend_key);
  if (b.to != null) setState('census_email_to', String(b.to).trim());   // keep census recipients in sync
  audit({ user: req.user, action: 'EMAIL_CONFIG', ip: req.ip });
  res.json({ ok: true, status: emailStatus() });
});
app.post('/api/email/test', requireAuth, requireAdmin, async (req, res) => {
  const to = (req.body?.to || getState('email_to') || getState('census_email_to') || '').trim();
  if (!to) return res.status(400).json({ error: 'Enter a test recipient.' });
  try {
    await sendEmail({ to, subject: 'Armada — test email ✓', html: '<p style="font-family:Georgia,serif">This is a test from Armada Care Standards. Email is connected. 🎉</p>' });
    res.json({ ok: true, to });
  } catch (e) { res.status(502).json({ error: e.message || 'Send failed' }); }
});

// ---- Texting (Twilio) setup, in-app. Secrets stored server-side. ----
app.get('/api/sms/config', requireAuth, requireAdmin, (req, res) => {
  const st = smsStatus();
  res.json({ ...st, hasToken: !!(getState('email_sms_token') || process.env.TWILIO_TOKEN) });
});
app.post('/api/sms/config', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const set = (k, v) => { if (v !== undefined) setState('email_' + k, (v == null ? '' : String(v)).trim()); };
  set('sms_sid', b.sid); set('sms_from', b.from);
  if (b.token) set('sms_token', b.token);                 // only overwrite if provided
  if (b.oncall != null) setState('oncall_phone', String(b.oncall).trim());
  audit({ user: req.user, action: 'SMS_CONFIG', ip: req.ip });
  res.json({ ok: true, status: smsStatus() });
});
app.post('/api/sms/test', requireAuth, requireAdmin, async (req, res) => {
  const to = (req.body?.to || getState('oncall_phone') || '').trim();
  if (!to) return res.status(400).json({ error: 'Enter a test phone number (e.g. +13305551212).' });
  try { await sendSms({ to, body: 'Armada test text ✓ — texting is connected.' }); res.json({ ok: true, to }); }
  catch (e) { res.status(502).json({ error: e.message || 'Send failed' }); }
});

// FULL KIPU CHART: list every documented evaluation/form on a client, and read
// any single one on demand. This is the whole chart, not the AI's sample.
app.get('/api/clients/:id/chart', requireAuth, async (req, res) => {
  const c = db.prepare(`SELECT kipu_id FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  audit({ user: req.user, action: 'CHART_LIST', entity: 'client', entity_id: +req.params.id, ip: req.ip });
  if (!c.kipu_id || !kipuConfigured()) return res.json({ evaluations: [], extras: [], kipu: false });
  const all = req.query.all === '1';
  const cacheKey = c.kipu_id + '|' + all;
  const hit = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 90000) return res.json(hit.data);
  try {
    // Chart list + extra resources fetched in PARALLEL.
    const [evaluations, ex] = await Promise.all([
      kipuPatientChart(c.kipu_id, { all }),
      kipuPatientExtras(c.kipu_id).catch(() => ({ entries: [], diag: [] })),
    ]);
    const data = { evaluations, extras: ex.entries, diag: ex.diag, all, kipu: true };
    chartCache.set(cacheKey, { at: Date.now(), data });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/clients/:id/chart/:evalId', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.evalId)) return res.status(400).json({ error: 'Bad evaluation id' });
  const c = db.prepare(`SELECT kipu_id FROM clients WHERE id = ?`).get(req.params.id);
  if (!c?.kipu_id) return res.status(404).json({ error: 'No chart' });
  try {
    const ev = await kipuEvaluation(c.kipu_id, req.params.evalId);
    audit({ user: req.user, action: 'CHART_VIEW', entity: 'client', entity_id: +req.params.id, detail: ev.name, ip: req.ip });
    res.json(ev);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

const CLIENT_FIELDS = ['name', 'pref', 'room', 'program', 'admit', 'admit_time', 'sober', 'therapist', 'case_manager', 'referral_source', 'touch', 'prefs', 'goals', 'triggers', 'safety', 'support', 'anchor_why', 'welcome_plan', 'aftercare_plan'];

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
  // Single source of truth: when Kipu is connected, clients come ONLY from the
  // chart. No manually-created clients (that would be a second source of truth).
  if (kipuConfigured()) return res.status(400).json({ error: 'Clients are pulled from Kipu — create the admission in Kipu, then fill the Care Card here.' });
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

// Set / clear a client's photo (staff-uploaded, for face-matching). Stored as a
// small data URL on the profile. Reliable regardless of whether Kipu has photos.
app.post('/api/clients/:id/photo', requireAuth, (req, res) => {
  const photo = req.body?.photo;
  if (photo) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) return res.status(400).json({ error: 'Expected a JPEG/PNG/WebP image.' });
    if (photo.length > 600000) return res.status(400).json({ error: 'Image too large — please use a smaller photo.' });
  }
  const c = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE clients SET photo = ? WHERE id = ?`).run(photo || null, req.params.id);
  audit({ user: req.user, action: photo ? 'PHOTO_SET' : 'PHOTO_CLEAR', entity: 'client', entity_id: +req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// Generate the first-72-hour Welcome plan from OUR policy + the Care Card, and
// save it. Not a free-text field — it's authored by Claude from the Standard.
app.post('/api/clients/:id/welcome-plan', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'AI is not configured.' });
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  try {
    const plan = await generateWelcomePlan(c);
    db.prepare(`UPDATE clients SET welcome_plan = ? WHERE id = ?`).run(plan, c.id);
    audit({ user: req.user, action: 'WELCOME_PLAN', entity: 'client', entity_id: c.id, ip: req.ip });
    res.json({ welcome_plan: plan });
  } catch (e) { res.status(502).json({ error: e.message || 'Could not generate.' }); }
});

app.post('/api/clients/:id/aftercare-plan', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'AI is not configured.' });
  const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  try {
    const plan = await generateAftercarePlan(c);
    db.prepare(`UPDATE clients SET aftercare_plan = ? WHERE id = ?`).run(plan, c.id);
    audit({ user: req.user, action: 'AFTERCARE_PLAN', entity: 'client', entity_id: c.id, ip: req.ip });
    res.json({ aftercare_plan: plan });
  } catch (e) { res.status(502).json({ error: e.message || 'Could not generate.' }); }
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
async function runAndStoreAmaRead(client, user, ip, extraNotes = []) {
  const pulses = recentPulses(client.id);
  const handoffs = db.prepare(`SELECT note FROM handoffs WHERE client_id = ? ORDER BY id DESC LIMIT 6`).all(client.id);
  // extraNotes (e.g. Kipu documentation) are fed in as additional context.
  const read = await generateAmaRead(client, pulses, [...extraNotes, ...handoffs]);
  db.prepare(
    `INSERT INTO ama_reads (client_id, level, summary, triggers, actions, approach, underlying, cared_for, best_play, withdrawal_level, withdrawal_note, med_concerns, step_down, transport, anticipated_dc, discharge_plan, doc_flags, unmet, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(client.id, read.level, read.summary, JSON.stringify(read.triggers),
    JSON.stringify(read.actions), read.approach, read.underlying || null,
    JSON.stringify(read.cared_for || []), read.best_play || null,
    read.withdrawal_level || null, read.withdrawal || null, JSON.stringify(read.med_concerns || []),
    read.step_down || null, read.transport || null, read.anticipated_dc || null,
    read.discharge_plan || null, JSON.stringify(read.doc_flags || []), JSON.stringify(read.unmet || []), user.id);
  if (read.snapshot && read.snapshot.trim())
    db.prepare(`UPDATE clients SET summary = ?, summary_at = datetime('now') WHERE id = ?`).run(read.snapshot.trim(), client.id);
  if (read.likes && read.likes.trim())
    db.prepare(`UPDATE clients SET likes = ? WHERE id = ?`).run(read.likes.trim(), client.id);
  // Refresh the AI case-management tasks: drop prior open AI ones, re-add current
  // needs (preserving anything already logged or marked done).
  if (Array.isArray(read.case_needs)) {
    db.prepare(`DELETE FROM case_tasks WHERE client_id = ? AND source = 'ai' AND status = 'open'`).run(client.id);
    const keep = new Set(db.prepare(`SELECT lower(item) i FROM case_tasks WHERE client_id = ?`).all(client.id).map((r) => r.i));
    const ins = db.prepare(`INSERT INTO case_tasks (client_id, category, item, source) VALUES (?,?,?,'ai')`);
    for (const n of read.case_needs) {
      const item = (n.item || '').trim(); if (!item || keep.has(item.toLowerCase())) continue;
      ins.run(client.id, n.category || 'Other', item); keep.add(item.toLowerCase());
    }
  }
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

// ---- Batch risk assessment: read every active client's Kipu documentation and
// score their AMA risk, in the background, with live progress. ----
let assessJob = { running: false, total: 0, done: 0, high: 0, elevated: 0, low: 0, flagged: 0, errors: 0, lastError: null, current: null, startedAt: null, finishedAt: null };
async function runAssessAll(user, opts = {}) {
  let clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  // Incremental (scheduled) runs only read clients with NO read or a stale one —
  // re-reading everyone every few hours burns the daily AI token budget.
  if (opts.incremental) {
    const staleH = +(process.env.ASSESS_STALE_HOURS || 18);
    clients = clients.filter((c) => {
      const a = latestAmaRead(c.id);
      if (!a || !a.created_at) return true;
      return (Date.now() - Date.parse(String(a.created_at).replace(' ', 'T') + 'Z')) > staleH * 3600e3;
    });
    if (!clients.length) { assessJob = { ...assessJob, running: false, finishedAt: Date.now() }; return; }
  }
  // Clear stale auto-generated risk/concern alerts so a re-run refreshes rather
  // than piling up duplicates.
  db.prepare(`DELETE FROM alerts WHERE kind IN ('risk', 'concern') AND status = 'New'`).run();
  assessJob = { running: true, total: clients.length, done: 0, high: 0, elevated: 0, low: 0, flagged: 0, errors: 0, aborted: false, lastError: null, current: null, startedAt: Date.now(), finishedAt: null };
  const assessOne = async (c) => {
    assessJob.current = c.pref || c.name;
    try {
      let extra = [];
      if (c.kipu_id && kipuConfigured()) {
        try {
          const np = await kipuPatientNotes(c.kipu_id);
          const txt = np.text;
          if (np.therapist && !c.therapist) db.prepare(`UPDATE clients SET therapist = ? WHERE id = ?`).run(np.therapist, c.id);
          if (np.case_manager && !c.case_manager) db.prepare(`UPDATE clients SET case_manager = ? WHERE id = ?`).run(np.case_manager, c.id);
          if (np.forms) db.prepare(`UPDATE clients SET doc_forms = ? WHERE id = ?`).run(JSON.stringify(np.forms), c.id);
          if (txt && txt.trim()) {
            extra = [{ note: 'Kipu documentation:\n' + txt }];
            try {
              const scan = await scanNote(txt, c.pref || c.name);
              db.prepare(`DELETE FROM notes WHERE client_id = ? AND source = 'Kipu (auto)'`).run(c.id);
              if (scan && scan.flagged) {
                db.prepare(`INSERT INTO notes (client_id, text, author, source, flagged, flag_level, flag_summary, categories, suggested_action)
                  VALUES (?,?,?,?,?,?,?,?,?)`).run(c.id, txt.slice(0, 4000), 'Kipu EMR', 'Kipu (auto)', 1,
                  scan.level || null, scan.summary || null, JSON.stringify(scan.categories || []), scan.suggested_action || null);
                if (scan.level === 'High' || scan.level === 'Elevated') createAlert(c.id, 'concern', scan.level, `${c.pref || c.name} — ${scan.summary || 'flag from Kipu notes'}`);
                assessJob.flagged++;
              }
            } catch { /* scan optional */ }
          }
        } catch { /* notes optional */ }
      }
      const read = await runAndStoreAmaRead(c, user, '0.0.0.0', extra);
      assessJob[read.level === 'High' ? 'high' : read.level === 'Elevated' ? 'elevated' : 'low']++;
      // Proactive alert: a client whose read turns High surfaces without anyone looking.
      if (read.level === 'High') createAlert(c.id, 'risk', 'High', `${c.pref || c.name} — high risk of leaving. ${read.best_play || read.summary || 'Run the Save.'}`);
      // Ingest Kipu-charted rounds (the auditable source of truth) into obs_checks.
      if (c.kipu_id && kipuConfigured() && process.env.KIPU_ROUNDS_SYNC !== 'false') {
        try {
          const rounds = await kipuClientRounds(c.kipu_id);
          const exists = db.prepare(`SELECT 1 FROM obs_checks WHERE kipu_eval_id = ?`);
          const insR = db.prepare(`INSERT INTO obs_checks (client_id, status, note, by_name, source, kipu_eval_id, ts) VALUES (?, 'ok', ?, ?, 'kipu', ?, ?)`);
          for (const r of rounds) {
            if (!r.eval_id || exists.get(r.eval_id)) continue;
            insR.run(c.id, r.name, r.by || 'Kipu', r.eval_id, String(r.ts).replace('T', ' ').slice(0, 19));
          }
        } catch { /* rounds optional */ }
      }
      // (Welcome/aftercare plans are generated ON-DEMAND from the Care Card, not
      // here — keeps the batch's daily token use down.)
    } catch (e) {
      assessJob.errors++; assessJob.lastError = (e?.message || String(e)).slice(0, 200);
      if (e?.dailyLimit) { assessJob.aborted = true; assessJob.lastError = 'Daily AI limit reached — paused. Try again later, or raise the Bedrock token quota.'; }
    }
    assessJob.done++;
  };
  // Assess several clients CONCURRENTLY (each does Kipu + AI). AI_CONCURRENCY tunes it.
  const limit = Math.max(1, +(process.env.AI_CONCURRENCY || 2));
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, clients.length) }, async () => {
    while (idx < clients.length && !assessJob.aborted) { const c = clients[idx++]; await assessOne(c); }
  }));
  assessJob.running = false; assessJob.current = null; assessJob.finishedAt = Date.now();
}
app.post('/api/assess-all', requireAuth, requireAdmin, (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured.' });
  if (assessJob.running) return res.json({ started: false, already: true });
  runAssessAll(req.user).catch((e) => { assessJob.running = false; console.error('[assess]', e.message); });   // fire-and-forget; poll status
  res.json({ started: true });
});
app.get('/api/assess-all/status', requireAuth, requireAdmin, (req, res) => res.json(assessJob));

// ---- Discharge debriefs: read every recent discharge's notes and learn what we
// could have done better (esp. AMA). Fills discharge type/reason/improve. ----
let debriefJob = { running: false, total: 0, done: 0, ama: 0, errors: 0, lastError: null, current: null, startedAt: null, finishedAt: null };
async function runDischargeDebriefs(user) {
  const clients = db.prepare(`SELECT * FROM clients WHERE source = 'kipu' AND discharge_status IS NOT NULL
    AND discharge_date >= date('now','-21 day') AND (discharge_improve IS NULL OR discharge_improve = '')`).all();
  debriefJob = { running: true, total: clients.length, done: 0, ama: 0, errors: 0, lastError: null, current: null, startedAt: Date.now(), finishedAt: null };
  for (const c of clients) {
    debriefJob.current = c.pref || c.name;
    try {
      let notes = '';
      if (c.kipu_id && kipuConfigured()) { try { notes = (await kipuPatientNotes(c.kipu_id)).text; } catch { /* care card only */ } }
      const d = await generateDischargeDebrief(c, notes);
      db.prepare(`UPDATE clients SET discharge_status = ?, discharge_reason = ?, discharge_followthrough = ?, discharge_improve = ? WHERE id = ?`)
        .run(d.type && d.type !== 'Unknown' ? d.type : (c.discharge_status || 'Discharged'),
          d.reason || null, (d.warning_signs || []).join('; ') || null, (d.could_do_better || []).join('; ') || null, c.id);
      if (d.type === 'AMA') { debriefJob.ama++; createAlert(c.id, 'concern', 'Elevated', `${c.pref || c.name} left AMA — learn: ${d.summary || 'see debrief'}`); }
      audit({ user, action: 'DISCHARGE_DEBRIEF', entity: 'client', entity_id: c.id, detail: d.type, ip: '0.0.0.0' });
    } catch { debriefJob.errors++; }
    debriefJob.done++;
  }
  debriefJob.running = false; debriefJob.current = null; debriefJob.finishedAt = Date.now();
}
app.post('/api/debrief-discharges', requireAuth, requireAdmin, (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured.' });
  if (debriefJob.running) return res.json({ started: false, already: true });
  runDischargeDebriefs(req.user).catch((e) => { debriefJob.running = false; console.error('[debrief]', e.message); });
  res.json({ started: true });
});
app.get('/api/debrief-discharges/status', requireAuth, requireAdmin, (req, res) => res.json(debriefJob));
/* ---------------- Case management ---------------- */
// Per-client case-management needs (AI from notes + manual), so the CM sees what
// to help with before the client asks. Plus what each client likes.
app.get('/api/case-management', requireAuth, (req, res) => {
  const clients = db.prepare(`SELECT id, pref, name, room, program, likes FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const getTasks = db.prepare(`SELECT * FROM case_tasks WHERE client_id = ? ORDER BY (status='done'), id DESC`);
  const rows = clients.map((c) => ({ ...c, name: c.pref || c.name, tasks: getTasks.all(c.id) })).filter((c) => c.tasks.length || c.likes);
  const openCount = db.prepare(`SELECT COUNT(*) n FROM case_tasks t JOIN clients c ON c.id=t.client_id WHERE t.status='open' AND c.active=1 AND c.discharge_status IS NULL`).get().n;
  const byCat = db.prepare(`SELECT category k, COUNT(*) n FROM case_tasks t JOIN clients c ON c.id=t.client_id WHERE t.status='open' AND c.active=1 AND c.discharge_status IS NULL GROUP BY category ORDER BY n DESC`).all();
  res.json({ clients: rows, openCount, byCategory: byCat, categories: CASE_CATEGORIES });
});
app.post('/api/case-tasks', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !(b.item || '').trim()) return res.status(400).json({ error: 'client_id and item required' });
  const info = db.prepare(`INSERT INTO case_tasks (client_id, category, item, source) VALUES (?,?,?,'manual')`).run(+b.client_id, b.category || 'Other', b.item.trim());
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/case-tasks/:id/done', requireAuth, (req, res) => {
  const done = req.body?.done !== false;
  db.prepare(`UPDATE case_tasks SET status = ?, done_by = ?, done_at = ? WHERE id = ?`)
    .run(done ? 'done' : 'open', done ? req.user.name : null, done ? new Date().toISOString() : null, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/case-tasks/:id', requireAuth, (req, res) => { db.prepare(`DELETE FROM case_tasks WHERE id = ?`).run(req.params.id); res.json({ ok: true }); });

// ---- Dignity Kit: every active client gets one; delivery must be confirmed by
// the owner. Outstanding kits raise an alert; overdue ones are tracked. ----
const DIGNITY_DUE_HOURS = +(process.env.DIGNITY_DUE_HOURS || 2);
const DIGNITY_ROLE = process.env.DIGNITY_OWNER_ROLE || 'BHT / Tech';
function ensureDignityKits() {
  const need = db.prepare(`SELECT id, pref, name FROM clients
    WHERE active = 1 AND discharge_status IS NULL AND id NOT IN (SELECT client_id FROM dignity_kits)`).all();
  const ins = db.prepare(`INSERT OR IGNORE INTO dignity_kits (client_id, due_by, assigned_role) VALUES (?, datetime('now', ?), ?)`);
  for (const c of need) {
    ins.run(c.id, `+${DIGNITY_DUE_HOURS} hours`, DIGNITY_ROLE);
    createAlert(c.id, 'dignity', 'Normal', `${c.pref || c.name} — deliver Dignity Kit and confirm`);
  }
  // Keep the delivery window + owner in step with the current config for kits
  // still outstanding (so a config change applies retroactively).
  db.prepare(`UPDATE dignity_kits SET due_by = datetime(needed_at, ?), assigned_role = COALESCE(assigned_role, ?)
    WHERE status = 'needed'`).run(`+${DIGNITY_DUE_HOURS} hours`, DIGNITY_ROLE);
  return need.length;
}
app.get('/api/dignity', requireAuth, (req, res) => {
  ensureDignityKits();
  const rows = db.prepare(`SELECT k.*, c.pref, c.name, c.room,
      (k.status='needed' AND k.due_by IS NOT NULL AND k.due_by < datetime('now')) AS overdue
    FROM dignity_kits k JOIN clients c ON c.id = k.client_id
    WHERE c.active = 1 AND c.discharge_status IS NULL ORDER BY overdue DESC, k.due_by`).all();
  const map = (r) => ({ id: r.id, client_id: r.client_id, name: r.pref || r.name, room: r.room, status: r.status,
    due_by: r.due_by, assigned_role: r.assigned_role, assigned_name: r.assigned_name,
    delivered_by: r.delivered_by, delivered_at: r.delivered_at, overdue: !!r.overdue,
    late: r.status === 'delivered' && r.due_by && r.delivered_at && r.delivered_at > r.due_by });
  const all = rows.map(map);
  const outstanding = all.filter((r) => r.status === 'needed');
  const delivered = all.filter((r) => r.status === 'delivered');
  // Accountability: deliveries per person, and who currently owns overdue kits.
  const byPerson = {};
  for (const d of delivered) { const k = d.delivered_by || '—'; (byPerson[k] = byPerson[k] || { name: k, delivered: 0, late: 0 }).delivered++; if (d.late) byPerson[k].late++; }
  res.json({
    outstanding, delivered, overdueCount: outstanding.filter((o) => o.overdue).length,
    deliveredToday: delivered.filter((d) => (d.delivered_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    accountability: Object.values(byPerson).sort((a, b) => b.delivered - a.delivered),
    dueHours: DIGNITY_DUE_HOURS, ownerRole: DIGNITY_ROLE,
  });
});
app.post('/api/dignity/:id/deliver', requireAuth, (req, res) => {
  const k = db.prepare(`SELECT * FROM dignity_kits WHERE id = ?`).get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE dignity_kits SET status='delivered', delivered_by=?, delivered_at=datetime('now'), note=COALESCE(?, note) WHERE id=?`)
    .run(req.user.name, req.body?.note || null, k.id);
  db.prepare(`UPDATE alerts SET status='Resolved' WHERE client_id=? AND kind='dignity' AND status='New'`).run(k.client_id);
  audit({ user: req.user, action: 'DIGNITY_DELIVER', entity: 'client', entity_id: k.client_id, ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/dignity/:id/na', requireAuth, (req, res) => {
  const k = db.prepare(`SELECT client_id FROM dignity_kits WHERE id = ?`).get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE dignity_kits SET status='na', delivered_by=?, delivered_at=datetime('now'), note=COALESCE(?, note) WHERE id=?`)
    .run(req.user.name, req.body?.note || 'not needed', req.params.id);
  db.prepare(`UPDATE alerts SET status='Resolved' WHERE client_id=? AND kind='dignity' AND status='New'`).run(k.client_id);
  res.json({ ok: true });
});
app.post('/api/dignity/:id/assign', requireAuth, requireAdmin, (req, res) => {
  const u = req.body?.user_id ? db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(req.body.user_id) : null;
  db.prepare(`UPDATE dignity_kits SET assigned_to=?, assigned_name=? WHERE id=?`).run(u?.id || null, u?.name || null, req.params.id);
  res.json({ ok: true });
});
app.post('/api/dignity/:id/reopen', requireAuth, (req, res) => {
  const k = db.prepare(`SELECT client_id FROM dignity_kits WHERE id = ?`).get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE dignity_kits SET status='needed', delivered_by=NULL, delivered_at=NULL WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// Detox Watch: active clients with moderate/severe withdrawal or med concerns.
app.get('/api/detox-watch', requireAuth, (req, res) => {
  const clients = db.prepare(`SELECT id, pref, name, room FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const rank = { Severe: 0, Moderate: 1 };
  const watch = [];
  for (const c of clients) {
    const a = latestAmaRead(c.id);
    if (!a) continue;
    const med = safeArr(a.med_concerns);
    const w = a.withdrawal_level;
    if ((w && ['Moderate', 'Severe'].includes(w)) || med.length) {
      watch.push({ id: c.id, name: c.pref || c.name, room: c.room, withdrawal_level: w || 'Unknown', withdrawal: a.withdrawal_note || '', med_concerns: med });
    }
  }
  watch.sort((x, y) => (rank[x.withdrawal_level] ?? 9) - (rank[y.withdrawal_level] ?? 9) || y.med_concerns.length - x.med_concerns.length);
  res.json({ watch });
});
app.get('/api/discharge-learnings', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, pref, name, discharge_status, discharge_date, discharge_reason, discharge_improve
    FROM clients WHERE discharge_status IS NOT NULL AND discharge_date >= date('now','-60 day')
    ORDER BY discharge_date DESC LIMIT 60`).all();
  res.json({ discharges: rows });
});

// ---- Leadership Command Center (admin/leadership only) ----
// One screen that operationalizes the Clinical Director's daily review: flow,
// the 3.2-WM step-down clock, discharge planning, documentation compliance,
// staffing coverage — every number pulled live from Kipu where we have it.
function daysSince(s) {
  if (!s) return null;
  const t = Date.parse(String(s).length <= 10 ? s + 'T00:00:00' : s);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 864e5);
}
const isDetoxProgram = (p) => /detox|withdrawal|\bwm\b|3\.?2|3\.?7/i.test(p || '');

app.get('/api/command/overview', requireAuth, requireAdmin, (req, res) => {
  const today = appToday();
  const active = db.prepare(`SELECT id, pref, name, room, program, loc, admit, next_loc, anticipated_dc FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();

  // Flow
  const admitsToday = active.filter((c) => (c.admit || '').slice(0, 10) === today).length;
  const admitsTodayList = active.filter((c) => (c.admit || '').slice(0, 10) === today).map((c) => ({ name: c.pref || c.name, loc: c.loc && c.loc !== 'Unspecified' ? c.loc : (parseLoc(c.program) || '') }));
  const discharges7d = db.prepare(`SELECT COUNT(*) n FROM clients WHERE discharge_status IS NOT NULL AND discharge_date >= date('now','-7 day')`).get().n;
  const dischargesToday = db.prepare(`SELECT COUNT(*) n FROM clients WHERE substr(discharge_date,1,10) = ?`).get(today).n;
  const dischargesTodayList = db.prepare(`SELECT id, pref, name, discharge_status, discharge_reason FROM clients WHERE substr(discharge_date,1,10) = ?`).all(today)
    .map((c) => ({ id: c.id, name: c.pref || c.name, status: c.discharge_status || '', reason: c.discharge_reason || '' }));
  // Recent discharges (3 days) so a just-after-midnight view still shows them.
  const dischargesRecentList = db.prepare(`SELECT id, pref, name, discharge_status, discharge_reason, substr(discharge_date,1,10) d
    FROM clients WHERE discharge_status IS NOT NULL AND discharge_date >= date('now','-3 day') ORDER BY discharge_date DESC`).all()
    .map((c) => ({ id: c.id, name: c.pref || c.name, status: c.discharge_status || '', reason: c.discharge_reason || '', date: c.d }));
  const sendoutsActive = db.prepare(`SELECT client_name, destination, reason FROM medical_sendouts WHERE status = 'out' ORDER BY sent_at DESC`).all();

  // Per-client latest read, computed once.
  const enriched = active.map((c) => {
    const a = latestAmaRead(c.id);
    return {
      id: c.id, name: c.pref || c.name, room: c.room, program: c.program, admit: c.admit,
      loc: c.loc && c.loc !== 'Unspecified' ? c.loc : (parseLoc(c.program) || 'Unspecified'),
      los: daysSince(c.admit),
      level: a?.level || null,
      // Prefer Kipu's structured next-level-of-care + anticipated date; fall back
      // to what the AI inferred from the notes.
      step_down: c.next_loc ? (parseLoc(c.next_loc) !== 'Unspecified' ? parseLoc(c.next_loc) : c.next_loc) : (a?.step_down || 'Unknown'),
      transport: a?.transport || 'Unknown',
      anticipated_dc: c.anticipated_dc || a?.anticipated_dc || '',
      discharge_plan: a?.discharge_plan || '',
      doc_flags: a ? safeArr(a.doc_flags) : [],
      withdrawal_level: a?.withdrawal_level || null,
    };
  });

  // 3.2-WM step-down clock: detox clients, with the >4-day flag.
  const detox = enriched.filter((c) => isDetoxProgram(c.program))
    .map((c) => ({ ...c, overdue: c.los != null && c.los > 4 }))
    .sort((a, b) => (b.los ?? -1) - (a.los ?? -1));

  // Discharge planning
  const stepDownCounts = {};
  enriched.forEach((c) => { stepDownCounts[c.step_down] = (stepDownCounts[c.step_down] || 0) + 1; });
  const transportNeeded = enriched.filter((c) => c.transport === 'Needed');
  const undecided = enriched.filter((c) => c.step_down === 'Undecided');
  const anticipated = enriched.filter((c) => c.anticipated_dc).map((c) => ({ id: c.id, name: c.name, room: c.room, when: c.anticipated_dc, step_down: c.step_down, transport: c.transport }));

  // Documentation compliance: anyone with a flagged gap.
  const docGaps = enriched.filter((c) => c.doc_flags.length).map((c) => ({ id: c.id, name: c.name, room: c.room, flags: c.doc_flags }));
  const docClean = enriched.length - docGaps.length;

  // Staffing coverage today
  const slotsToday = db.prepare(`SELECT s.id, s.needed, s.part, s.role,
    (SELECT COUNT(*) FROM schedule_assignments a WHERE a.slot_id=s.id AND a.status='scheduled') AS sched
    FROM schedule_slots s WHERE s.date = ?`).all(today);
  const needed = slotsToday.reduce((n, s) => n + s.needed, 0);
  const scheduled = slotsToday.reduce((n, s) => n + s.sched, 0);
  const gaps = slotsToday.filter((s) => s.sched < s.needed).map((s) => ({ part: s.part, role: s.role, short: s.needed - s.sched }));
  const callOffsToday = db.prepare(`SELECT COUNT(*) n FROM schedule_assignments a JOIN schedule_slots s ON s.id=a.slot_id WHERE a.status='called_off' AND s.date = ?`).get(today).n;

  // Census by ASAM level of care: count + average length of stay per level.
  // When a client has no parseable ASAM code, fall back to their raw program
  // name so the row is meaningful (the real label) rather than "Unspecified".
  const byLoc = {};
  for (const c of enriched) {
    let key = c.loc || 'Unspecified';
    if (key === 'Unspecified' && c.program && String(c.program).trim()) key = String(c.program).trim();
    const b = byLoc[key] || (byLoc[key] = { key, count: 0, losSum: 0, losN: 0 });
    b.count++; if (c.los != null) { b.losSum += c.los; b.losN++; }
  }
  const locCensus = Object.values(byLoc)
    .map((r) => {
      const coded = LOC_RANK[r.key] != null;     // a known ASAM/pseudo level
      const fullLabel = LOC_LABEL[r.key] || r.key;
      return {
        code: coded ? r.key : '',
        label: coded ? fullLabel.replace(r.key + ' · ', '') : r.key,   // program name when uncoded
        count: r.count,
        avgLos: r.losN ? Math.round(r.losSum / r.losN * 10) / 10 : null,
      };
    })
    .sort((a, b) => (LOC_RANK[b.code] ?? -1) - (LOC_RANK[a.code] ?? -1) || b.count - a.count);

  // Step-downs: where clients have moved, over the last 30 days, by destination level.
  const stepRows = db.prepare(`SELECT from_loc, to_loc FROM flow_events WHERE kind='loc_change' AND date >= date('now','-30 day')`).all();
  const stepByDest = {};
  let stepDowns = 0, stepUps = 0;
  for (const r of stepRows) {
    const fr = LOC_RANK[r.from_loc] ?? null, to = LOC_RANK[r.to_loc] ?? null;
    if (fr != null && to != null) { if (to < fr) stepDowns++; else if (to > fr) stepUps++; }
    if (r.to_loc) { (stepByDest[r.to_loc] = stepByDest[r.to_loc] || { code: r.to_loc, label: LOC_LABEL[r.to_loc] || r.to_loc, n: 0 }).n++; }
  }
  const stepDestList = Object.values(stepByDest).sort((a, b) => b.n - a.n);

  // Daily flow snapshot — today, plus the running 14-day trend (from now on).
  rollupDailyMetrics(today);
  const todayMetrics = db.prepare(`SELECT intakes, discharges, loc_changes, ama, census FROM daily_metrics WHERE date = ?`).get(today) || { intakes: 0, discharges: 0, loc_changes: 0, ama: 0, census: active.length };
  const trend = db.prepare(`SELECT date, intakes, discharges, loc_changes, ama, census FROM daily_metrics WHERE date >= date('now','-13 day') ORDER BY date`).all();

  // Care Card completion (hospitality layer) — within the first hour of admit.
  const ccRows = db.prepare(`SELECT touch, prefs, anchor_why, admit, admit_time FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  let ccComplete = 0, ccOverdue = 0;
  for (const c of ccRows) { const st = careCardStatus(c); if (st.complete) ccComplete++; else { const m = careCardMinsSinceAdmit(c); if (m != null && m > CARECARD_DUE_MIN) ccOverdue++; } }
  const careCards = { total: ccRows.length, complete: ccComplete, incomplete: ccRows.length - ccComplete, overdue: ccOverdue, dueMin: CARECARD_DUE_MIN };

  // Observation-rounds compliance: how many clients are within their check window.
  const obsRows = db.prepare(`SELECT c.obs_interval, (SELECT ts FROM obs_checks o WHERE o.client_id = c.id ORDER BY o.id DESC LIMIT 1) last FROM clients c WHERE c.active = 1 AND c.discharge_status IS NULL`).all();
  const nowMs = Date.now();
  let obsOverdue = 0;
  for (const r of obsRows) { const iv = r.obs_interval || OBS_DEFAULT_MIN; const t = r.last ? Date.parse(String(r.last).replace(' ', 'T') + 'Z') : null; const m = t ? Math.floor((nowMs - t) / 60000) : null; if (m == null || m >= iv) obsOverdue++; }
  const rounds = { total: obsRows.length, overdue: obsOverdue, onTime: obsRows.length - obsOverdue, pct: obsRows.length ? Math.round((obsRows.length - obsOverdue) / obsRows.length * 100) : null };

  // Checklist progress for today
  const chk = db.prepare(`SELECT COUNT(*) total, SUM(status='done') done FROM command_checklist WHERE date = ?`).get(today);

  // Scheduled to admit today (front-desk arrivals, from Salesforce).
  const schedRows = db.prepare(`SELECT pref_or_first AS name, status FROM (
      SELECT COALESCE(NULLIF(preferred_name,''), first_name) || ' ' || last_name AS pref_or_first, status
      FROM expected_arrivals WHERE scheduled_date = ?) ORDER BY status`).all(today);
  const scheduledArrivals = {
    total: schedRows.length,
    arrived: schedRows.filter((r) => r.status === 'arrived').length,
    waiting: schedRows.filter((r) => r.status === 'expected').length,
    noShow: schedRows.filter((r) => r.status === 'no_show').length,
    list: schedRows.map((r) => ({ name: r.name, status: r.status })),
  };

  const syncedAt = db.prepare(`SELECT max(updated_at) m FROM clients WHERE source = 'kipu'`).get()?.m || null;
  res.json({
    asOf: new Date().toISOString(),
    syncedAt,
    flow: { census: active.length, admitsToday, dischargesToday, discharges7d, admitsTodayList, dischargesTodayList, dischargesRecentList, sendouts: sendoutsActive },
    scheduled: scheduledArrivals,
    detox,
    levels: { census: locCensus, stepDowns, stepUps, stepByDest: stepDestList },
    daily: { today: todayMetrics, trend },
    planning: { stepDownCounts, transportNeeded, undecided, anticipated },
    documentation: { gaps: docGaps, clean: docClean, total: enriched.length },
    staffing: { needed, scheduled, gaps, callOffsToday, pct: needed ? Math.round(scheduled / needed * 100) : null },
    careCards,
    rounds,
    checklist: { total: chk?.total || 0, done: chk?.done || 0 },
  });
});

// Period summary since a given date (default: 1st of the current month).
// Pure Kipu/Salesforce data — scheduled, admitted, discharged, AMA + the
// discharge breakdown and an AMA drill-down list (reason + link to notes).
app.get('/api/command/since', requireAuth, requireAdmin, (req, res) => {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : appToday().slice(0, 8) + '01';
  const scheduled = db.prepare(`SELECT status, COUNT(*) n FROM expected_arrivals WHERE scheduled_date >= ? GROUP BY status`).all(since);
  const schedMap = Object.fromEntries(scheduled.map((r) => [r.status, r.n]));
  const schedTotal = scheduled.reduce((s, r) => s + r.n, 0);

  const admitted = db.prepare(`SELECT COUNT(*) n FROM clients WHERE substr(admit,1,10) >= ?`).get(since).n;
  const dischRows = db.prepare(`SELECT id, pref, name, discharge_status, discharge_reason, discharge_improve, admit, discharge_date, referral_source, therapist
    FROM clients WHERE discharge_date IS NOT NULL AND substr(discharge_date,1,10) >= ? ORDER BY discharge_date DESC`).all(since);
  const byStatus = {};
  for (const d of dischRows) { const s = d.discharge_status || 'Discharged'; byStatus[s] = (byStatus[s] || 0) + 1; }
  const losOf = (a, d) => { if (!a || !d) return null; const n = Math.round((Date.parse(d) - Date.parse(a)) / 864e5); return n >= 0 ? n : null; };
  const amaList = dischRows.filter((d) => d.discharge_status === 'AMA').map((d) => ({
    id: d.id, name: d.pref || d.name, date: (d.discharge_date || '').slice(0, 10),
    los: losOf(d.admit, d.discharge_date), reason: d.discharge_reason || '', improve: d.discharge_improve || '',
    referral: d.referral_source || '', therapist: d.therapist || '',
    hasRead: !!latestAmaRead(d.id),
  }));
  const amaCount = amaList.length;
  const losVals = dischRows.map((d) => losOf(d.admit, d.discharge_date)).filter((n) => n != null);
  const avgLos = losVals.length ? +(losVals.reduce((a, b) => a + b, 0) / losVals.length).toFixed(1) : null;
  // Every discharge in the period, clickable through to the chart.
  const dischList = dischRows.map((d) => ({
    id: d.id, name: d.pref || d.name, date: (d.discharge_date || '').slice(0, 10),
    status: d.discharge_status || 'Discharged', los: losOf(d.admit, d.discharge_date),
    reason: d.discharge_reason || d.discharge_improve || '', therapist: d.therapist || '',
    hasRead: !!latestAmaRead(d.id),
  }));

  res.json({
    since,
    scheduled: { total: schedTotal, arrived: schedMap.arrived || 0, noShow: schedMap.no_show || 0, expected: schedMap.expected || 0 },
    admitted,
    discharged: { total: dischRows.length, byStatus, avgLos, amaRate: dischRows.length ? Math.round(amaCount / dischRows.length * 100) : 0, list: dischList },
    ama: { count: amaCount, list: amaList },
  });
});

// Diagnostic: show exactly what is being counted as "discharges today" —
// the flow-events for today and the clients whose discharge_date is today,
// with source/active/kipu_id so we can see what they actually are.
app.get('/api/command/discharge-debug', requireAuth, requireAdmin, (req, res) => {
  const today = appToday();
  const flowEvents = db.prepare(`SELECT f.id feid, f.kind, f.date, f.detail, f.client_id,
      c.name, c.source, c.kipu_id, c.active, c.discharge_status, c.discharge_date, c.admit, c.created_at
    FROM flow_events f LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.date = ? AND f.kind IN ('discharge','ama') ORDER BY c.name`).all(today);
  const orphans = flowEvents.filter((r) => r.name == null).length;
  const dischargeDateToday = db.prepare(`SELECT id, name, source, kipu_id, active, discharge_status, discharge_date, admit, created_at
    FROM clients WHERE substr(discharge_date,1,10) = ? ORDER BY name`).all(today);
  const bySource = {};
  for (const c of dischargeDateToday) { const s = c.source || 'null'; bySource[s] = (bySource[s] || 0) + 1; }
  res.json({ today, flowEventCount: flowEvents.length, orphanFlowEvents: orphans, flowEvents, dischargeDateTodayCount: dischargeDateToday.length, bySource, clients: dischargeDateToday });
});
// Cleanup: delete orphaned flow-events (whose client no longer exists) and any
// discharge flow-events whose client is no longer discharged. Re-rolls today.
app.post('/api/command/discharge-cleanup', requireAuth, requireAdmin, (req, res) => {
  const today = appToday();
  const orphans = db.prepare(`DELETE FROM flow_events WHERE kind IN ('discharge','ama')
    AND (client_id IS NULL OR client_id NOT IN (SELECT id FROM clients))`).run().changes;
  const stale = db.prepare(`DELETE FROM flow_events WHERE kind IN ('discharge','ama')
    AND client_id IN (SELECT id FROM clients WHERE discharge_status IS NULL)`).run().changes;
  rollupDailyMetrics(today);
  audit({ user: req.user, action: 'DISCHARGE_CLEANUP', detail: `${orphans} orphan, ${stale} stale`, ip: req.ip });
  res.json({ orphansDeleted: orphans, staleDeleted: stale });
});

// Trending issues: cluster what clients are raising across ALL notes + check-ins,
// for the day and the week. Quantitative counts always; AI digest cached per day.
app.get('/api/command/issues', requireAuth, requireAdmin, async (req, res) => {
  const range = req.query.range === 'week' ? 'week' : 'day';
  const pulseSince = range === 'week' ? "date('now','-7 day')" : "date('now','-1 day')";
  const counts = {};
  const bump = (k) => { if (k == null) return; const s = String(k).trim(); if (s) counts[s] = (counts[s] || 0) + 1; };
  const lines = [];
  // PRIMARY SIGNAL: the per-client "unmet" items — things raised that we haven't
  // addressed during the stay (timeline-aware; intake baseline already excluded
  // by the read). This is what "we could do better," not what they arrived with.
  const active = db.prepare(`SELECT id, name, pref FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  for (const c of active) {
    const a = latestAmaRead(c.id);
    if (!a) continue;
    for (const item of safeArr(a.unmet)) { if (item && String(item).trim()) lines.push('- ' + scrub(String(item), [c.name, c.pref])); }
  }
  // SECONDARY: dated staff check-ins in the window (in-stay experience signal).
  const pulseRows = db.prepare(`SELECT p.date, p.statements, p.triggers, p.note, p.concern, c.name, c.pref
    FROM pulses p JOIN clients c ON c.id = p.client_id WHERE p.date >= ${pulseSince}`).all();
  for (const p of pulseRows) {
    const names = [p.name, p.pref];
    safeArr(p.triggers).forEach(bump);
    if (p.statements) lines.push(`- [${p.date}] "` + scrub(p.statements, names) + '"');
    if (p.note) lines.push(`- [${p.date}] ` + scrub(p.note, names));
  }
  const countList = Object.entries(counts).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 12);

  let digest = { top_issues: [], summary: '' };
  const cacheKey = 'issuecache_' + range, today = appToday(), refresh = req.query.refresh === '1';
  if (claudeConfigured() && lines.length) {
    try {
      const cached = JSON.parse(getState(cacheKey) || 'null');
      if (!refresh && cached && cached.day === today && cached.n === lines.length) digest = cached.data;
      else { digest = await generateIssueDigest(lines.slice(0, 200), range === 'week' ? 'the last 7 days' : 'the last 24 hours'); setState(cacheKey, JSON.stringify({ day: today, n: lines.length, data: digest })); }
    } catch (e) { /* counts are still returned */ }
  }
  res.json({ range, sampleSize: lines.length, counts: countList, digest, ai: claudeConfigured() });
});

// Director's Daily Review checklist — seeded from the standing template each day.
function seedChecklist(date) {
  const has = db.prepare(`SELECT 1 FROM command_checklist WHERE date = ? LIMIT 1`).get(date);
  if (has) return;
  const ins = db.prepare(`INSERT OR IGNORE INTO command_checklist (date, section, item, sort) VALUES (?,?,?,?)`);
  DIRECTOR_REVIEW.forEach(([section, item], i) => ins.run(date, section, item, i));
}
app.get('/api/command/checklist', requireAuth, requireAdmin, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : appToday();
  seedChecklist(date);
  const rows = db.prepare(`SELECT * FROM command_checklist WHERE date = ? ORDER BY sort, id`).all(date);
  res.json({ date, items: rows });
});
app.post('/api/command/checklist/:id', requireAuth, requireAdmin, (req, res) => {
  const status = ['open', 'done', 'na'].includes(req.body?.status) ? req.body.status : 'done';
  db.prepare(`UPDATE command_checklist SET status = ?, note = ?, done_by = ?, done_at = ? WHERE id = ?`)
    .run(status, req.body?.note ?? null, status === 'open' ? null : req.user.name, status === 'open' ? null : new Date().toISOString(), req.params.id);
  res.json({ ok: true });
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
  const today = appToday();
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
// One demo login per role, so leadership can walk through every dashboard.
app.post('/api/demo-staff', requireAuth, requireAdmin, (req, res) => {
  const password = 'ArmadaDemo1!';
  const users = [];
  for (const jr of JOB_ROLES) {
    const username = 'demo.' + jr.toLowerCase().replace(/[^a-z]+/g, '');
    if (db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)) { users.push({ name: 'Demo ' + jr, username, job_role: jr, status: 'exists' }); continue; }
    try { createUser({ name: 'Demo ' + jr, username, password, role: 'staff', job_role: jr }); users.push({ name: 'Demo ' + jr, username, job_role: jr, status: 'created' }); }
    catch { users.push({ name: 'Demo ' + jr, username, job_role: jr, status: 'error' }); }
  }
  audit({ user: req.user, action: 'DEMO_STAFF', detail: `${users.filter((u) => u.status === 'created').length} created`, ip: req.ip });
  res.json({ password, users });
});

/* ---------------- audit log (admin) ---------------- */
app.get('/api/audit', requireAuth, requireAdmin, (req, res) => {
  res.json({ entries: db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 300`).all() });
});

// Admin pre-flight: which AI provider/model is active and whether the
// structured-output params work (the key thing to verify after switching to Bedrock).
app.get('/api/ai/health', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await aiHealth()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message, provider: aiProvider() }); }
});

app.get('/api/meta', requireAuth, (req, res) => res.json({ shifts: SHIFTS, jobRoles: JOB_ROLES, claude: claudeConfigured(), kipu: kipuConfigured(), kipuWeb: getState('kipu_web') || process.env.KIPU_WEB_URL || '', amaTriggers: AMA_TRIGGERS, departments: DEPARTMENTS, scheduleTypes: SCHEDULE_TYPES, kioskCode: req.user.role === 'admin' ? kioskCode() : undefined, deidentify: DEID }));
app.post('/api/settings/kipu-web', requireAuth, requireAdmin, (req, res) => {
  setState('kipu_web', (req.body?.url || '').trim());
  audit({ user: req.user, action: 'KIPU_WEB_SET', ip: req.ip });
  res.json({ ok: true, kipuWeb: getState('kipu_web') || '' });
});

// Change my own password.
app.post('/api/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (!changePassword(req.user.id, current || '', next, req.cookies?.armada_sid)) return res.status(400).json({ error: 'Current password is incorrect.' });
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
  if (!DISCHARGE_TYPES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const d = date || new Date().toISOString().slice(0, 10);
  const b = req.body || {};
  const steps = b.steps ? JSON.stringify(b.steps) : null;
  db.prepare(`UPDATE clients SET discharge_status = ?, discharge_date = ?, discharge_destination = ?, departure_steps = ?, discharge_reason = ?, discharge_followthrough = ?, discharge_improve = ? WHERE id = ?`)
    .run(status, d, b.destination || null, steps, b.reason || null, b.followthrough || null, b.improve || null, req.params.id);
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
    aiProvider: aiProvider(), deidentify: DEID,
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
  try { const r = await kipuSyncRoster(); audit({ user: req.user, action: 'KIPU_SYNC', detail: `${r.created} new`, ip: req.ip }); afterSyncAssess(req.user); res.json(r); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/kipu/inspect', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await kipuInspect()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/kipu/reconcile', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await kipuReconcile()); } catch (e) { res.status(502).json({ error: e.message }); }
});
// One-time repair for discharge dates wrongly stamped "today" on a backfill.
app.post('/api/kipu/fix-discharge-dates', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await kipuFixDischargeDates(); audit({ user: req.user, action: 'KIPU_FIX_DC', detail: `${r.fixed} fixed`, ip: req.ip }); res.json(r); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/kipu/find-rounds', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await kipuFindRounds(req.body?.client || req.query.client)); } catch (e) { res.status(502).json({ error: e.message }); }
});
// Data coverage: for every field the app uses, show how many clients have it
// filled and where it comes from — so "is everything pulling?" is answerable.
app.get('/api/kipu/coverage', requireAuth, requireAdmin, (req, res) => {
  const active = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const discharged = db.prepare(`SELECT * FROM clients WHERE discharge_date IS NOT NULL AND discharge_date >= date('now','-90 day')`).all();
  const filled = (rows, fn) => rows.filter((c) => { const v = fn(c); return v != null && String(v).trim() !== ''; }).length;
  const F = (label, source, col, set = active) => ({ label, source, filled: filled(set, (c) => c[col]), total: set.length });
  const fields = [
    F('Name', 'Census', 'name'),
    F('Admit date', 'Census', 'admit'),
    F('Admit time', 'Census/detail', 'admit_time'),
    F('Date of birth', 'Census', 'dob'),
    F('Diagnosis', 'Census', 'diagnosis'),
    F('Insurance', 'Census', 'insurance'),
    F('Phone', 'Census', 'phone'),
    F('Pronouns', 'Census', 'pronouns'),
    F('Language', 'Census', 'language'),
    F('Level of care (ASAM)', 'Patient detail', 'loc'),
    F('Program', 'Patient detail', 'program'),
    F('Room / bed', 'Patient detail', 'room'),
    F('Primary therapist', 'Patient detail', 'therapist'),
    F('Case manager', 'Patient detail', 'case_manager'),
    F('Referral source', 'Patient detail / manual', 'referral_source'),
    { label: 'AI snapshot (from notes)', source: 'Evaluations', filled: filled(active, (c) => c.summary), total: active.length },
    F('Discharge type (AMA?)', 'Patient detail', 'discharge_status', discharged),
    F('Discharge reason', 'Patient detail', 'discharge_reason', discharged),
    F('Discharge destination', 'Patient detail', 'discharge_destination', discharged),
  ];
  res.json({ activeCount: active.length, dischargedCount: discharged.length, fields, kipu: kipuConfigured() });
});
app.post('/api/kipu/doc-inspect', requireAuth, requireAdmin, async (req, res) => {
  const cid = req.body?.kipu_id || db.prepare(`SELECT kipu_id FROM clients WHERE active = 1 AND kipu_id IS NOT NULL AND kipu_id != '' LIMIT 1`).get()?.kipu_id;
  if (!cid) return res.status(400).json({ error: 'No client with a Kipu id — sync the roster first.' });
  try { res.json(await kipuDocInspect(cid)); } catch (e) { res.status(502).json({ error: e.message }); }
});
// Preview the documentation we pull for one patient (admin verification).
app.post('/api/kipu/notes-preview', requireAuth, requireAdmin, async (req, res) => {
  const c = db.prepare(`SELECT kipu_id FROM clients WHERE active = 1 AND kipu_id IS NOT NULL AND kipu_id != '' LIMIT 1`).get();
  if (!c) return res.status(400).json({ error: 'No client with a Kipu id — sync the roster first.' });
  try {
    const np = await kipuPatientNotes(c.kipu_id);
    const txt = np.text;
    const blocks = txt.split(/\n\n(?=\[)/).filter(Boolean);
    const breakdown = blocks.map((b) => { const m = b.match(/^\[([^\]]+)\]/); return { head: m ? m[1] : '?', chars: b.length }; });
    res.json({ chars: txt.length, noteCount: breakdown.length, breakdown, therapist: np.therapist || null, case_manager: np.case_manager || null, debug: np.debug || null, preview: txt.slice(0, 4000) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Clean reset: wipe the roster and rebuild it from the live Kipu active census
// (use after test-syncs left stale/duplicate clients).
app.post('/api/kipu/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Clear ACTIVE clients to refresh the live census, but PRESERVE recent
    // discharge history (only purge discharges older than 90 days) — a Rebuild
    // must not erase the discharge record.
    db.prepare(`DELETE FROM clients WHERE active = 1 OR (discharge_date IS NOT NULL AND discharge_date < date('now','-90 day'))`).run();
    const r = await kipuSyncRoster();
    audit({ user: req.user, action: 'KIPU_RESET', detail: `rebuilt: ${r.created} active`, ip: req.ip });
    afterSyncAssess(req.user);
    res.json(r);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// After a manual sync/rebuild, run the AI note-read in the background so the
// snapshot / AMA risk / case needs populate without a separate click.
// Automations that fire on every Kipu sync. All idempotent — createAlert
// dedupes, and inserts are guarded — so re-running never piles up duplicates.
//  • Discharge → fond-farewell loop: Dignity Kit + 48h aftercare follow-up on
//    every discharge, plus a Save debrief alert for AMAs.
//  • New admit → welcome guardrail: Care Card overdue alert, and an intake
//    nudge when someone admitted without a scheduled record.
function runFlowAutomations() {
  const today = appToday();
  const recentDisch = db.prepare(`SELECT id, pref, name, discharge_status FROM clients
    WHERE discharge_date IS NOT NULL AND substr(discharge_date,1,10) >= date('now','-2 day')`).all();
  const insKit = db.prepare(`INSERT OR IGNORE INTO dignity_kits (client_id, due_by, assigned_role) VALUES (?, datetime('now', ?), ?)`);
  const hasKit = db.prepare(`SELECT 1 FROM dignity_kits WHERE client_id = ?`);
  const hasFollow = db.prepare(`SELECT 1 FROM followups WHERE client_id = ? AND type = ?`);
  const insFollow = db.prepare(`INSERT INTO followups (client_id, type, due_date) VALUES (?, ?, ?)`);
  let kits = 0, follows = 0;
  const FOLLOW_CADENCE = [['24h', 1], ['48h', 2], ['30d', 30]];
  for (const c of recentDisch) {
    if (!hasKit.get(c.id)) { insKit.run(c.id, `+${DIGNITY_DUE_HOURS} hours`, DIGNITY_ROLE); createAlert(c.id, 'dignity', 'Normal', `${c.pref || c.name} — Dignity Kit for a safe departure`); kits++; }
    for (const [type, days] of FOLLOW_CADENCE) { if (!hasFollow.get(c.id, type)) { insFollow.run(c.id, type, addDays(today, days)); follows++; } }
    if (/ama|against medical/i.test(c.discharge_status || '')) createAlert(c.id, 'concern', 'Elevated', `${c.pref || c.name} left AMA — run the Save debrief: what could we have done better?`);
  }
  const newAdmits = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL AND substr(admit,1,10) = ?`).all(today);
  for (const c of newAdmits) {
    if (!careCardStatus(c).complete) {
      const mins = careCardMinsSinceAdmit(c);
      if (mins != null && mins > CARECARD_DUE_MIN) createAlert(c.id, 'carecard', 'Elevated', `${c.pref || c.name} — Care Card not complete (${Math.floor(mins / 60)}h ${mins % 60}m since admit). Fill it within the hour.`);
    }
  }
  try {
    const matchedIds = new Set(db.prepare(`SELECT client_id FROM expected_arrivals WHERE client_id IS NOT NULL`).all().map((r) => r.client_id));
    const schedNames = new Set(db.prepare(`SELECT first_name, last_name FROM expected_arrivals WHERE scheduled_date >= date('now','-3 day')`).all().map((a) => normName(`${a.first_name || ''} ${a.last_name || ''}`)));
    for (const c of newAdmits) {
      if (!matchedIds.has(c.id) && !schedNames.has(normName(c.name))) createAlert(c.id, 'unscheduled', 'Normal', `${c.pref || c.name} admitted without a scheduled record — set their admit date in Salesforce.`);
    }
  } catch { /* arrivals optional */ }

  // Acuity-driven safety-check cadence: set the observation interval once from
  // the level of care (detox/withdrawal = tightest). Only fills it when unset,
  // so manual overrides and step-down relaxations are preserved.
  const setIv = db.prepare(`UPDATE clients SET obs_interval = ? WHERE id = ?`);
  for (const c of db.prepare(`SELECT id, loc, program FROM clients WHERE active = 1 AND discharge_status IS NULL AND obs_interval IS NULL`).all()) {
    setIv.run(obsIntervalForLoc(c.loc || c.program), c.id);
  }

  // Documentation auto-escalation: one summary alert per client whose required
  // docs have blown their SLA, naming the owner. Deduped daily (kind 'docs'), so
  // it surfaces accountability without drowning the urgent clinical alerts.
  const docClients = db.prepare(`SELECT id, pref, name, admit, admit_time, loc, diagnosis, insurance, therapist, case_manager, referral_source, doc_forms FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  for (const c of docClients) {
    const mins = careCardMinsSinceAdmit(c); if (mins == null) continue;
    let forms = null; try { forms = c.doc_forms ? JSON.parse(c.doc_forms) : null; } catch { /* ignore */ }
    const overdueDocs = [];
    for (const rq of DOC_REQS) {
      let ok; if (rq.form) { if (forms == null) continue; ok = !!forms[rq.form]; } else ok = !!rq.has(c);
      if (!ok && mins > rq.slaHrs * 60) overdueDocs.push(rq.label);
    }
    if (overdueDocs.length) {
      const owner = c.therapist || c.case_manager || '';
      createAlert(c.id, 'docs', 'Normal', `${c.pref || c.name} — ${overdueDocs.length} document(s) overdue: ${overdueDocs.slice(0, 3).join(', ')}${overdueDocs.length > 3 ? '…' : ''}${owner ? ` · ${owner}` : ''}. Document in Kipu.`);
    }
  }

  // Auto-onboarding: every admit gets its standard case-management checklist, so
  // nothing gets missed and Case Mgmt / accountability populate themselves.
  const recentAdmits = db.prepare(`SELECT id FROM clients WHERE active = 1 AND discharge_status IS NULL AND substr(admit,1,10) >= date('now','-3 day')`).all();
  const hasTasks = db.prepare(`SELECT 1 FROM case_tasks WHERE client_id = ? LIMIT 1`);
  const insTask = db.prepare(`INSERT INTO case_tasks (client_id, category, item, source) VALUES (?, ?, ?, 'auto')`);
  for (const c of recentAdmits) {
    if (hasTasks.get(c.id)) continue;
    for (const [cat, it] of ONBOARDING_TASKS) insTask.run(c.id, cat, it);
  }
  return { kits, follows };
}
// Recommended safety-check cadence (minutes) by level of care.
function obsIntervalForLoc(loc) {
  const l = String(loc || '');
  if (/3\.?7|3\.?2|\bwm\b|withdrawal|detox/i.test(l)) return +(process.env.OBS_DETOX_MIN || 30);   // medical/clinical withdrawal
  return +(process.env.OBS_DEFAULT_MIN || 60);                                                      // residential / lower acuity
}
// The standard case-management onboarding checklist, created on every admit.
const ONBOARDING_TASKS = [
  ['Insurance / Financial', 'Verify insurance & authorization'],
  ['Communication', 'Confirm therapist & case manager assigned'],
  ['Medical / Dental', 'Biopsychosocial assessment completed'],
  ['Aftercare / Housing', 'Treatment plan started'],
  ['Aftercare / Housing', 'Aftercare / housing plan opened'],
  ['ID / Documents', 'Collect ID & documents'],
  ['Family / Support', 'Emergency contact & family confirmed'],
];
// New admit → welcome ready: draft the welcome/first-72h plan from policy for
// fresh admits that don't have one yet. Capped per run and fails fast on the AI
// daily limit so it never blows the token budget. Disable with WELCOME_AUTO=false.
async function autoWelcomePlans() {
  if (!claudeConfigured() || process.env.WELCOME_AUTO === 'false') return;
  const cap = +(process.env.WELCOME_AUTO_MAX || 3);
  const need = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL
    AND (welcome_plan IS NULL OR welcome_plan = '') AND substr(admit,1,10) >= date('now','-2 day')
    ORDER BY admit DESC LIMIT ?`).all(cap);
  for (const c of need) {
    try { const plan = await generateWelcomePlan(c); db.prepare(`UPDATE clients SET welcome_plan = ? WHERE id = ?`).run(plan, c.id); }
    catch (e) { if (e.dailyLimit) break; console.error('[welcome-plan auto]', c.id, e.message); }
  }
}
function afterSyncAssess(user) {
  try { chartCache.clear(); } catch { /* cache may not be ready */ }
  try { ensureDignityKits(); } catch (e) { console.error('[dignity] ensure:', e.message); }
  try { reconcileArrivals(); } catch (e) { console.error('[arrivals] reconcile:', e.message); } // new admits auto-arrive
  try { runFlowAutomations(); } catch (e) { console.error('[automations]:', e.message); }
  try { autoWelcomePlans(user); } catch (e) { console.error('[welcome-plan auto]:', e.message); }
  if (claudeConfigured() && process.env.KIPU_AUTO_ASSESS !== 'false' && !assessJob.running) {
    runAssessAll({ id: user?.id ?? null, name: user?.name || 'Sync' }, { incremental: true }).catch((e) => console.error('[assess] after sync:', e.message));
  }
}
// Azure SQL data-warehouse (Chaim's Kipu warehouse) — read-only sync.
app.get('/api/warehouse/status', requireAuth, requireAdmin, (req, res) => res.json({ configured: whConfigured() }));
app.post('/api/warehouse/test', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await whTest()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/warehouse/columns', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await whColumns()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/warehouse/sync', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await whSyncRoster(db); audit({ user: req.user, action: 'WH_SYNC', detail: `${r.created} new, ${r.matched} updated`, ip: req.ip }); res.json(r); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/warehouse/sync-notes', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await whSyncNotes(db, scanNote, { days: +req.body?.days || 3 }); audit({ user: req.user, action: 'WH_NOTES', detail: `${r.flagged} flagged`, ip: req.ip }); res.json(r); }
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
  if (!req.query.client_id) return res.json({ goals: [] });
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
  audit({ user: req.user, action: 'VIEW', entity: 'client', entity_id: +req.params.id, detail: 'journey', ip: req.ip });
  const today = appToday();
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
  const names = [c.name, c.pref];
  const s = (x) => scrub(x, names);
  const line = (l, v) => (v && String(v).trim() ? `${l}: ${s(v).trim()}\n` : '');
  const ama = latestAmaRead(c.id);
  const pulses = recentPulses(c.id, 5);
  const goals = db.prepare(`SELECT text, status FROM goals WHERE client_id = ?`).all(c.id);
  const reqs = db.prepare(`SELECT department, text FROM requests WHERE client_id = ? AND status != 'Done'`).all(c.id);
  const concerns = db.prepare(`SELECT text FROM concerns WHERE client_id = ? AND status = 'Open'`).all(c.id);
  const visit = db.prepare(`SELECT contact_name, date FROM visits WHERE client_id = ? AND date >= date('now') AND status = 'Scheduled' ORDER BY date LIMIT 1`).get(c.id);
  return `Brief this client for the team today.\n\n` +
    (DEID ? 'Client: the client (name & dates withheld for privacy)\n' : (line('Preferred name', c.pref) + line('Name', c.name) + line('Admitted', c.admit) + line('Sobriety date', c.sober) + line('Support', c.support))) +
    line('Program', c.program) + line('Personal touch', c.touch) +
    line('⚓ Intake Anchor — why they came (their own words)', c.anchor_why) +
    line('Preferences', c.prefs) + line('Goals (free text)', c.goals) + line('Triggers', c.triggers) +
    line('Safety', c.safety) + line('Welcome plan', c.welcome_plan) +
    (ama ? `\nAMA risk: ${ama.level}. ${s(ama.summary)} Underlying: ${s(ama.underlying)}\n` : '') +
    (goals.length ? `\nGoals:\n` + goals.map((g) => `- ${s(g.text)} [${g.status}]`).join('\n') + '\n' : '') +
    (pulses.length ? `\nRecent pulses:\n` + pulses.map((p) => `- ${p.date} ${p.shift} concern:${p.concern} ${(p.triggers || []).join(', ')} ${s(p.statements || '')}`).join('\n') + '\n' : '') +
    (visit && !DEID ? `\nUpcoming family visit: ${visit.contact_name || 'family'} on ${visit.date}\n` : (visit ? '\nUpcoming family visit scheduled.\n' : '')) +
    (reqs.length ? `\nOpen requests: ` + reqs.map((r) => `${r.department}: ${s(r.text)}`).join('; ') + '\n' : '') +
    (concerns.length ? `\nOpen concerns: ` + concerns.map((r) => s(r.text)).join('; ') + '\n' : '');
}

// House context. In de-identified mode, clients are labelled "Client A/B/…";
// returns { text, map } so the caller can swap labels back to real names in the
// AI's output (names never reach Claude).
function buildHouseContext(shift) {
  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room`).all();
  const map = {};
  let ctx = `Shift briefing for ${shift || 'this'} shift. ${clients.length} active clients.\n\n`;
  clients.forEach((c, i) => {
    const label = DEID ? `Client ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}` : (c.pref || c.name);
    if (DEID) map[label] = c.pref || c.name;
    const names = [c.name, c.pref];
    const ama = latestAmaRead(c.id);
    const reqs = db.prepare(`SELECT text FROM requests WHERE client_id = ? AND status != 'Done'`).all(c.id);
    const parts = [];
    if (ama && ama.level !== 'Low') parts.push(`AMA risk ${ama.level}: ${scrub(ama.summary, names)}`);
    if (c.safety) parts.push(`safety: ${scrub(c.safety, names)}`);
    if (reqs.length) parts.push(`open requests: ${reqs.map((r) => scrub(r.text, names)).join('; ')}`);
    if (c.touch) parts.push(`personal touch: ${scrub(c.touch, names)}`);
    ctx += `• ${label}${(!DEID && c.room) ? ' (Room ' + c.room + ')' : ''}: ${parts.join(' | ') || 'stable'}\n`;
  });
  return { text: ctx, map };
}
function reidentify(text, map) {
  if (!text || !map) return text;
  let out = text;
  for (const [label, name] of Object.entries(map)) out = out.split(label).join(name);
  return out;
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
    const { text, map } = buildHouseContext(req.body?.shift);
    const brief = reidentify(await generateShiftBriefing(text), map);
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
// ---- Role-tailored employee dashboard: each title opens to exactly what they
// do this shift, framed around the three steps of service (welcome / anticipate
// / farewell). Reuses the live client data; no new tables. ----
function localHour() {
  return +new Intl.DateTimeFormat('en-US', { timeZone: APP_TZ, hour: '2-digit', hour12: false }).format(new Date()).replace(/\D/g, '');
}
function nameMatches(field, userName) {
  if (!field || !userName) return false;
  const f = String(field).toLowerCase(), u = String(userName).toLowerCase().trim();
  if (!u) return false;
  if (f.includes(u)) return true;
  const last = u.split(/\s+/).pop();
  return last && last.length > 2 && f.includes(last);
}
// Anticipation engine: turn each Care Card's preferences into timely, specific
// actions to deliver WITHOUT being asked. Deterministic keyword reads of the
// prefs/likes/touch fields, framed by time of day. The Ritz "unexpressed need."
function anticipationNudges(clients, hour) {
  const out = [];
  const evening = hour >= 17 || hour < 6;
  const morning = hour >= 6 && hour < 11;
  for (const c of clients) {
    const blob = [c.prefs, c.likes, c.touch, c.support, c.goals].filter(Boolean).join(' ').toLowerCase();
    const name = c.pref || c.name;
    const seen = new Set();
    const push = (text, key) => { if (seen.has(key)) return; seen.add(key); out.push({ id: c.id, name, text, key }); };
    if (blob) {
      if (/coffee/.test(blob) && morning) push(`Bring ${name} their morning coffee.`, 'coffee');
      else if (/\btea\b/.test(blob)) push(`Offer ${name} a tea.`, 'tea');
      if (/(family|phone call|call home|daughter|son|wife|husband|\bmom\b|\bdad\b|mother|father|kids|grandkid|spouse)/.test(blob) && evening) push(`Offer ${name} a call to their family this evening — it anchors them.`, 'family');
      if (/(nicotine|smoke|cigarette|vape|tobacco)/.test(blob)) push(`${name} values their smoke break — offer it on schedule (per protocol).`, 'nicotine');
      if (/music/.test(blob)) push(`Put on ${name}'s music.`, 'music');
      if (/(blanket|cold|chilly|extra layer)/.test(blob)) push(`Offer ${name} an extra blanket.`, 'blanket');
      if (/(walk|fresh air|outside|outdoors|fresh-air)/.test(blob)) push(`Offer ${name} a few minutes of fresh air.`, 'air');
      if (/(prayer|church|faith|bible|\bgod\b|spiritual|quran|temple|synagogue)/.test(blob)) push(`Ask ${name} if they'd like quiet time for prayer.`, 'faith');
      if (/(anxious|anxiety|panic|nervous|overwhelm)/.test(blob)) push(`Check in with ${name} — they run anxious; a calm word helps.`, 'anxiety');
    }
    if (!seen.size && c.touch && c.touch.trim()) push(`Deliver ${name}'s personal touch: ${c.touch.trim()}`, 'touch');
  }
  return out.slice(0, 12);
}
app.get('/api/dashboard', requireAuth, (req, res) => {
  const today = appToday();
  const h = localHour();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = (req.user.name || '').split(/\s+/)[0] || 'there';
  const jr = req.user.job_role || '';
  const active = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const dischToday = db.prepare(`SELECT id, pref, name, discharge_status, discharge_reason, anticipated_dc, next_loc, medications, allergies FROM clients WHERE substr(discharge_date,1,10) = ? OR (anticipated_dc IS NOT NULL AND substr(anticipated_dc,1,10) <= date('now','+1 day'))`).all(today);
  const item = (c, sub, badge) => ({ id: c.id, name: c.pref || c.name, room: c.room || '', sub: sub || '', badge: badge || '' });
  const isNew = (c) => (c.admit || '').slice(0, 10) === today;
  const riskOf = (c) => { const a = latestAmaRead(c.id); return a && a.level ? a.level : null; };
  const ccIncomplete = (c) => !careCardStatus(c).complete;

  // Per-client observation overdue (for BHT/Nurse rounds).
  const obsDefault = +(process.env.OBS_DEFAULT_MIN || 60);
  const lastObs = db.prepare(`SELECT client_id, MAX(ts) ts FROM obs_checks GROUP BY client_id`).all().reduce((a, r) => (a[r.client_id] = r.ts, a), {});
  const obsOverdue = (c) => { const iv = c.obs_interval || obsDefault; const t = lastObs[c.id] ? Date.parse(String(lastObs[c.id]).replace(' ', 'T') + 'Z') : null; const m = t ? Math.floor((Date.now() - t) / 60000) : null; return m == null || m >= iv; };

  const sections = []; let tiles = []; let northStar = null; let subtitle = '';

  // Shared building blocks
  const newAdmits = active.filter(isNew);
  const atRisk = active.map((c) => ({ c, lvl: riskOf(c) })).filter((x) => x.lvl === 'High' || x.lvl === 'Elevated');
  const personalTouches = active.filter((c) => (c.touch && c.touch.trim()) || (c.prefs && c.prefs.trim()));

  if (jr === 'Nurse') {
    subtitle = 'Medical watch — withdrawal, meds, and the safety of every client.';
    const detox = active.filter((c) => isDetoxProgram(c.program) || /3\.?7|3\.?2|wm/i.test(c.loc || ''));
    const sendouts = db.prepare(`SELECT client_name name, destination, reason FROM medical_sendouts WHERE status = 'out' ORDER BY sent_at DESC`).all();
    const overdue = active.filter(obsOverdue);
    northStar = { label: 'Safety checks current', value: active.length ? Math.round((active.length - overdue.length) / active.length * 100) + '%' : '—', sev: overdue.length ? 'warn' : 'ok' };
    tiles = [
      { key: 'newadmits', label: 'New — need nursing assessment', n: newAdmits.length, sev: newAdmits.length ? 'warn' : 'ok' },
      { key: 'withdrawal', label: 'Withdrawal watch', n: detox.length, sev: detox.length ? 'warn' : 'ok' },
      { key: 'checks', label: 'Safety checks due', n: overdue.length, sev: overdue.length ? 'high' : 'ok' },
      { key: 'sendouts', label: 'Out (ED / hospital)', n: sendouts.length, sev: sendouts.length ? 'high' : 'ok' },
    ];
    sections.push({ key: 'newadmits', title: 'Welcome — new admits needing assessment', items: newAdmits.map((c) => item(c, c.program || '', 'NEW')) });
    sections.push({ key: 'withdrawal', title: 'Anticipate — withdrawal watch (detox)', items: detox.map((c) => item(c, c.loc || c.program || '', riskOf(c) || '')) });
    sections.push({ key: 'checks', title: 'Safety checks due', items: active.filter(obsOverdue).map((c) => item(c, 'overdue for a check')) });
    sections.push({ key: 'sendouts', title: 'Medical send-outs (currently out)', items: sendouts.map((s) => ({ name: s.name, sub: (s.destination || '') + (s.reason ? ' · ' + s.reason : ''), badge: 'OUT' })) });
    sections.push({ key: 'farewell', title: 'Send-off today — meds & naloxone', items: dischToday.map((c) => item(c, c.discharge_status || 'planned')) });
  } else if (jr === 'Therapist') {
    subtitle = 'Your caseload — sessions, notes, and catching the quiet AMA.';
    const mine = active.filter((c) => nameMatches(c.therapist, req.user.name));
    const caseload = mine.length ? mine : active;   // fallback: whole house if names don't match yet
    const docDue = caseload.filter((c) => { let f = {}; try { f = JSON.parse(c.doc_forms || '{}'); } catch { } return !f.biopsych || !f.tx_plan; });
    const risk = caseload.map((c) => ({ c, lvl: riskOf(c) })).filter((x) => x.lvl === 'High' || x.lvl === 'Elevated');
    const planning = caseload.filter((c) => c.anticipated_dc || c.next_loc);
    northStar = { label: 'Caseload documented', value: caseload.length ? Math.round((caseload.length - docDue.length) / caseload.length * 100) + '%' : '—', sev: docDue.length ? 'warn' : 'ok' };
    tiles = [
      { key: 'caseload', label: 'My clients', n: caseload.length, sev: 'ok' },
      { key: 'docs', label: 'Notes / plans due', n: docDue.length, sev: docDue.length ? 'high' : 'ok' },
      { key: 'risk', label: 'At risk — run the Save', n: risk.length, sev: risk.length ? 'high' : 'ok' },
      { key: 'planning', label: 'Aftercare to plan', n: planning.length, sev: planning.length ? 'warn' : 'ok' },
    ];
    if (!mine.length) subtitle += ' (Showing the whole house — assign therapists in Kipu to see just yours.)';
    sections.push({ key: 'risk', title: 'Anticipate — at risk of leaving (the Save)', items: risk.map((x) => item(x.c, x.c.anchor_why ? 'anchor: ' + x.c.anchor_why : '', x.lvl)) });
    sections.push({ key: 'docs', title: 'Documentation due — biopsychosocial / treatment plan', items: docDue.map((c) => item(c, c.program || '')) });
    sections.push({ key: 'planning', title: 'Send-off — aftercare to plan', items: planning.map((c) => item(c, (c.next_loc ? '→ ' + c.next_loc : '') + (c.anticipated_dc ? ' · by ' + String(c.anticipated_dc).slice(0, 10) : ''))) });
    sections.push({ key: 'caseload', title: 'My caseload', items: caseload.map((c) => item(c, c.program || '', riskOf(c) || '')) });
  } else if (jr === 'Case Manager') {
    subtitle = 'Coordination — case tasks, aftercare, and follow-ups.';
    const mine = active.filter((c) => nameMatches(c.case_manager, req.user.name));
    const caseload = mine.length ? mine : active;
    const tasks = db.prepare(`SELECT t.id, t.text, t.category, c.id cid, c.pref, c.name FROM case_tasks t JOIN clients c ON c.id = t.client_id WHERE t.status = 'open' AND c.active = 1 AND c.discharge_status IS NULL ORDER BY t.id DESC`).all();
    const myTasks = mine.length ? tasks.filter((t) => caseload.some((c) => c.id === t.cid)) : tasks;
    const followups = db.prepare(`SELECT f.id, f.due_date, c.id cid, c.pref, c.name FROM followups f JOIN clients c ON c.id = f.client_id WHERE f.status = 'Pending' ORDER BY f.due_date`).all();
    const planning = caseload.filter((c) => c.anticipated_dc || c.next_loc);
    northStar = { label: 'Open case tasks', value: myTasks.length, sev: myTasks.length ? 'warn' : 'ok' };
    tiles = [
      { key: 'caseload', label: 'My clients', n: caseload.length, sev: 'ok' },
      { key: 'tasks', label: 'Open case tasks', n: myTasks.length, sev: myTasks.length ? 'warn' : 'ok' },
      { key: 'planning', label: 'Aftercare to plan', n: planning.length, sev: planning.length ? 'warn' : 'ok' },
      { key: 'followups', label: 'Follow-ups due', n: followups.length, sev: followups.length ? 'high' : 'ok' },
    ];
    sections.push({ key: 'tasks', title: 'Open case tasks', items: myTasks.map((t) => ({ id: t.cid, name: t.pref || t.name, sub: (t.category ? '[' + t.category + '] ' : '') + t.text })) });
    sections.push({ key: 'planning', title: 'Send-off — aftercare to plan', items: planning.map((c) => item(c, (c.next_loc ? '→ ' + c.next_loc : '') + (c.anticipated_dc ? ' · by ' + String(c.anticipated_dc).slice(0, 10) : ''))) });
    sections.push({ key: 'followups', title: 'Follow-up calls due', items: followups.map((f) => ({ id: f.cid, name: f.pref || f.name, sub: 'due ' + (f.due_date || '') })) });
    sections.push({ key: 'caseload', title: 'My caseload', items: caseload.map((c) => item(c, c.program || '')) });
  } else if (jr === 'Front Desk') {
    subtitle = 'The warm welcome — greet every arrival by name.';
    const arr = db.prepare(`SELECT preferred_name, first_name, last_name, status, referral_source FROM expected_arrivals WHERE scheduled_date = ? ORDER BY status`).all(today);
    const waiting = arr.filter((a) => a.status === 'expected'); const arrived = arr.filter((a) => a.status === 'arrived'); const noshow = arr.filter((a) => a.status === 'no_show');
    northStar = { label: 'Arriving today', value: arr.length, sev: waiting.length ? 'warn' : 'ok' };
    tiles = [
      { key: 'arrivals', label: 'Still expected', n: waiting.length, sev: waiting.length ? 'warn' : 'ok', view: 'arrivals' },
      { key: 'arrived', label: 'Arrived', n: arrived.length, sev: 'ok', view: 'arrivals' },
      { key: 'noshow', label: 'No-show follow-up', n: noshow.length, sev: noshow.length ? 'high' : 'ok', view: 'arrivals' },
    ];
    const arrItem = (a) => ({ name: ((a.preferred_name || a.first_name || '') + ' ' + (a.last_name || '')).trim(), sub: a.referral_source ? 'via ' + a.referral_source : '', badge: a.status === 'no_show' ? 'NO-SHOW' : a.status === 'arrived' ? 'ARRIVED' : '' });
    sections.push({ key: 'arrivals', title: 'Welcome — expected today', items: waiting.map(arrItem), cta: { label: 'Open Front Desk →', view: 'arrivals' } });
    sections.push({ key: 'board', title: 'Already arrived', items: arrived.map(arrItem) });
  } else if (jr === 'Housekeeping') {
    subtitle = 'The Environment Standard — the physical stage is spotless, calm, and ready for the next guest.';
    const beds = db.prepare(`SELECT room, label, unit, status FROM beds`).all();
    const cleaning = beds.filter((b) => /clean/i.test(b.status || ''));
    const hold = beds.filter((b) => /hold/i.test(b.status || ''));
    const openB = beds.filter((b) => /open/i.test(b.status || ''));
    const freedToday = db.prepare(`SELECT pref, name, room, discharge_status FROM clients WHERE substr(discharge_date,1,10) = ?`).all(today);
    const arrivals = db.prepare(`SELECT preferred_name, first_name, last_name FROM expected_arrivals WHERE scheduled_date = ? AND status = 'expected'`).all(today);
    const turnover = cleaning.length + freedToday.length;
    northStar = { label: 'Beds ready', value: openB.length || '—', sev: (arrivals.length > openB.length) ? 'warn' : 'ok' };
    tiles = [
      { key: 'turnover', label: 'Rooms to turn over', n: turnover, sev: turnover ? 'high' : 'ok' },
      { key: 'prep', label: 'Arrivals to prep for', n: arrivals.length, sev: arrivals.length ? 'warn' : 'ok' },
      { key: 'ready', label: 'Beds ready', n: openB.length, sev: 'ok' },
      { key: 'hold', label: 'On hold', n: hold.length, sev: hold.length ? 'warn' : 'ok' },
    ];
    sections.push({ key: 'turnover', title: 'Turn over — discharged today (refresh the room with care)', items: freedToday.map((c) => ({ name: c.pref || c.name, room: c.room || '', sub: c.discharge_status || 'discharged', badge: 'TURN OVER' })) });
    if (cleaning.length) sections.push({ key: 'cleaning', title: 'Beds marked Cleaning', items: cleaning.map((b) => ({ name: (b.room || '') + (b.label ? ' · ' + b.label : ''), sub: b.unit || '', badge: 'CLEANING' })) });
    sections.push({ key: 'prep', title: 'Prep — guests arriving today (ready a warm, spotless room)', items: arrivals.map((a) => ({ name: ((a.preferred_name || a.first_name || '') + ' ' + (a.last_name || '')).trim() })), cta: { label: 'See arrivals →', view: 'arrivals' } });
    if (hold.length) sections.push({ key: 'hold', title: 'On hold', items: hold.map((b) => ({ name: b.room || '', sub: b.unit || '' })) });
    sections.push({ key: 'standard', title: 'The senses — every space, every shift', items: [
      { name: 'Sight', sub: 'No clutter, no trash, surfaces clear, beds made tight.' },
      { name: 'Smell', sub: 'Fresh and clean — never bleach-harsh, never stale.' },
      { name: 'Touch', sub: 'Fresh linens, stocked supplies, nothing broken or sticky.' },
      { name: 'Calm', sub: 'Quiet, ordered, dignified — a place that says “you matter.”' },
    ] });
  } else if (jr === 'Kitchen') {
    subtitle = 'The Table — no one here is ever hungry. Honor every diet.';
    const diets = active.filter((c) => (c.allergies && c.allergies.trim()) || /diabet|allerg|gluten|vegan|vegetarian|kosher|halal|renal|puree/i.test((c.diagnosis || '') + ' ' + (c.prefs || '')));
    northStar = { label: 'Clients on the unit', value: active.length, sev: 'ok' };
    tiles = [
      { key: 'diets', label: 'Special diets / allergies', n: diets.length, sev: diets.length ? 'warn' : 'ok' },
      { key: 'clients', label: 'Mouths to feed', n: active.length, sev: 'ok' },
      { key: 'new', label: 'New today', n: newAdmits.length, sev: newAdmits.length ? 'warn' : 'ok' },
    ];
    sections.push({ key: 'diets', title: 'Dietary needs & allergies — honor these', items: diets.map((c) => item(c, [c.allergies, c.prefs].filter(Boolean).join(' · '), c.allergies ? 'ALLERGY' : '')) });
    sections.push({ key: 'new', title: 'New today — make their first meal land', items: newAdmits.map((c) => item(c)) });
  } else {
    // BHT / Tech (default) — the heartbeat of the house
    subtitle = 'The heartbeat of the house — welcome, watch, and the personal touches.';
    const overdue = active.filter(obsOverdue);
    const toWelcome = newAdmits.filter(ccIncomplete);
    northStar = { label: 'Safety checks current', value: active.length ? Math.round((active.length - overdue.length) / active.length * 100) + '%' : '—', sev: overdue.length ? 'high' : 'ok' };
    tiles = [
      { key: 'welcome', label: 'New — welcome & fill card', n: toWelcome.length, sev: toWelcome.length ? 'high' : 'ok' },
      { key: 'rounds', label: 'Safety checks due', n: overdue.length, sev: overdue.length ? 'high' : 'ok', view: 'rounds' },
      { key: 'watch', label: 'Watch tonight (at risk)', n: atRisk.length, sev: atRisk.length ? 'high' : 'ok' },
      { key: 'touches', label: 'Personal touches to deliver', n: personalTouches.length, sev: personalTouches.length ? 'warn' : 'ok' },
    ];
    sections.push({ key: 'welcome', title: 'Welcome — new arrivals (fill the Care Card, greet by name)', items: toWelcome.map((c) => item(c, c.program || '', 'NEW')) });
    sections.push({ key: 'watch', title: 'Watch tonight — at risk of leaving (run the Save)', items: atRisk.map((x) => item(x.c, x.c.anchor_why ? 'why they came: ' + x.c.anchor_why : '', x.lvl)) });
    sections.push({ key: 'touches', title: "Anticipate — personal touches to deliver", items: personalTouches.map((c) => item(c, c.touch || c.prefs || '')) });
    sections.push({ key: 'rounds', title: 'Safety checks due', items: overdue.map((c) => item(c, 'overdue for a check')), cta: { label: 'Open Rounds →', view: 'rounds' } });
  }

  // The Horst layer, on every role's dashboard: today's Standard (the lineup
  // ritual) and recent recognition (catch people doing it right).
  const focus = focusForDate(today);
  const wins = db.prepare(`SELECT w.text, w.by_name, c.pref FROM wows w LEFT JOIN clients c ON c.id = w.client_id ORDER BY w.id DESC LIMIT 5`).all()
    .map((w) => ({ text: w.text, by: w.by_name || '', client: w.pref || '' }));
  // Anticipation nudges for the care-facing roles (the unexpressed-need engine).
  const nudges = (jr === 'Nurse' || jr === 'BHT / Tech' || jr === '' || jr === 'Team') ? anticipationNudges(active, h) : [];
  // Your week — healthy pride: recognition you've given, touches delivered, and
  // your streak of showing up to the daily Standard.
  const uid = req.user.id;
  const wowsWeek = db.prepare(`SELECT COUNT(*) n FROM wows WHERE by_id = ? AND created_at >= datetime('now','-7 day')`).get(uid).n;
  const delightsWeek = db.prepare(`SELECT COUNT(*) n FROM delights WHERE by_id = ? AND created_at >= datetime('now','-7 day')`).get(uid).n;
  const fdays = new Set(db.prepare(`SELECT DISTINCT date FROM focus_logs WHERE user_id = ? AND date >= date('now','-30 day')`).all(uid).map((r) => r.date));
  let streak = 0, cursor = today; while (fdays.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  const stats = { wowsWeek, delightsWeek, standardStreak: streak };
  res.json({ jobRole: jr || 'Team', greeting: `${greet}, ${first}`, subtitle, northStar, tiles, sections, nudges, stats, focus: { topic: focus.t, goal: focus.g }, wins });
});

// Moments of Truth — the three steps of service, made measurable per client:
// warm welcome (Care Card known), anticipation (a personal touch delivered),
// and a fond farewell (Dignity Kit at departure). Leadership's service north star.
app.get('/api/moments', requireAuth, requireAdmin, (req, res) => {
  const active = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const delightSet = new Set(db.prepare(`SELECT DISTINCT client_id FROM delights WHERE client_id IS NOT NULL`).all().map((r) => r.client_id));
  const kitDelivered = new Set(db.prepare(`SELECT client_id FROM dignity_kits WHERE status = 'delivered'`).all().map((r) => r.client_id));
  const nm = (c) => ({ id: c.id, name: c.pref || c.name, room: c.room || '', status: c.discharge_status || '' });
  const notWelcomed = [], notAnticipated = [];
  let welcomedN = 0, anticipatedN = 0;
  for (const c of active) {
    if (careCardStatus(c).complete) welcomedN++; else notWelcomed.push(nm(c));
    if (delightSet.has(c.id)) anticipatedN++; else notAnticipated.push(nm(c));
  }
  const disch = db.prepare(`SELECT * FROM clients WHERE discharge_date IS NOT NULL AND substr(discharge_date,1,10) >= date('now','-30 day') ORDER BY discharge_date DESC`).all();
  let farewellN = 0; const farewellGap = [];
  for (const c of disch) { if (kitDelivered.has(c.id)) farewellN++; else farewellGap.push(nm(c)); }
  res.json({
    active: active.length,
    welcomed: { done: welcomedN, gap: notWelcomed },
    anticipated: { done: anticipatedN, gap: notAnticipated },
    farewell: { total: disch.length, done: farewellN, gap: farewellGap },
  });
});
app.get('/api/today', requireAuth, (req, res) => {
  const today = appToday();
  const clients = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL`).all();
  const attention = [];
  for (const c of clients) {
    const ama = latestAmaRead(c.id);
    if (ama && ama.level !== 'Low') attention.push({ kind: 'risk', level: ama.level, client_id: c.id, text: `${c.pref || c.name} — AMA risk ${ama.level}${ama.summary ? ': ' + ama.summary : ''}` });
    if (c.admit && (Date.now() - new Date(c.admit + 'T00:00').getTime()) <= 3 * 864e5) {
      if (c.anchor_why && c.anchor_why.trim()) attention.push({ kind: 'welcome', client_id: c.id, text: `${c.pref || c.name} — in the first 72 hours (the wave). ⚓ Anchor: “${c.anchor_why.trim()}”` });
      else attention.push({ kind: 'welcome', client_id: c.id, text: `${c.pref || c.name} — in the first 72 hours. Deliver the welcome — and capture their ⚓ Intake Anchor (why they came, in their words).` });
    }
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
    let ctx, map = null;
    if (req.body?.client_id) {
      const c = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.body.client_id);
      ctx = c ? buildClientContext(c) : 'No such client.';
    } else {
      const h = buildHouseContext('current'); ctx = h.text; map = h.map;
    }
    const qOut = DEID ? scrub(q, db.prepare(`SELECT name, pref FROM clients WHERE active = 1`).all().flatMap((c) => [c.name, c.pref]).filter(Boolean)) : q;
    const answer = reidentify(await askAssistant(qOut, ctx), map);
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

/* ---------------- Outbound referrals & partners ---------------- */
// Vocabulary for the front-end (kept here so a new reason/department deploys once).
app.get('/api/referrals/meta', requireAuth, (req, res) => res.json({
  departments: REFERRAL_DEPARTMENTS, categories: REFERRAL_CATEGORIES,
  reasons: REFERRAL_REASONS, facilityTypes: FACILITY_TYPES,
  salesforce: sfConfigured(),
}));

app.get('/api/facilities', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM outbound_referrals o WHERE o.facility_id = f.id) AS sent,
      (SELECT COUNT(*) FROM inbound_referrals i WHERE i.facility_id = f.id) AS received
    FROM facilities f WHERE f.active = 1 ORDER BY f.name COLLATE NOCASE`).all();
  res.json({ facilities: rows });
});
app.post('/api/facilities', requireAuth, (req, res) => {
  const b = req.body || {}; const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Facility name required.' });
  const existing = db.prepare(`SELECT id FROM facilities WHERE name = ? COLLATE NOCASE`).get(name);
  if (existing) return res.json({ id: existing.id, existed: true });
  const info = db.prepare(`INSERT INTO facilities (name, type, location, contact, notes) VALUES (?,?,?,?,?)`)
    .run(name, b.type || null, b.location || null, b.contact || null, b.notes || null);
  audit({ user: req.user, action: 'CREATE', entity: 'facility', entity_id: info.lastInsertRowid, detail: name, ip: req.ip });
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/referrals', requireAuth, (req, res) => {
  const where = [], args = [];
  if (req.query.category) { where.push('o.category = ?'); args.push(req.query.category); }
  if (req.query.department) { where.push('o.department = ?'); args.push(req.query.department); }
  if (req.query.facility_id) { where.push('o.facility_id = ?'); args.push(+req.query.facility_id); }
  if (req.query.referred_by) { where.push('o.referred_by = ?'); args.push(+req.query.referred_by); }
  if (req.query.from) { where.push('o.ref_date >= ?'); args.push(req.query.from); }
  if (req.query.to) { where.push('o.ref_date <= ?'); args.push(req.query.to); }
  const sql = `SELECT o.*, c.pref AS client_pref FROM outbound_referrals o
    LEFT JOIN clients c ON c.id = o.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.ref_date DESC, o.id DESC LIMIT 200`;
  res.json({ referrals: db.prepare(sql).all(...args) });
});

app.post('/api/referrals', requireAuth, (req, res) => {
  const b = req.body || {};
  const category = REFERRAL_CATEGORIES.some((c) => c.key === b.category) ? b.category : 'declined';
  const department = REFERRAL_DEPARTMENTS.includes(b.department) ? b.department : 'Clinical';
  if (!b.facility_id && !(b.facility_name || '').trim()) return res.status(400).json({ error: 'Pick or name a destination facility.' });
  if (!(b.reason || '').trim()) return res.status(400).json({ error: 'Pick a reason.' });

  // Resolve / create the destination facility.
  let facilityId = b.facility_id ? +b.facility_id : null;
  let facilityName = (b.facility_name || '').trim();
  if (!facilityId && facilityName) {
    const f = db.prepare(`SELECT id FROM facilities WHERE name = ? COLLATE NOCASE`).get(facilityName);
    facilityId = f ? f.id : db.prepare(`INSERT INTO facilities (name) VALUES (?)`).run(facilityName).lastInsertRowid;
  }
  if (facilityId && !facilityName) facilityName = db.prepare(`SELECT name FROM facilities WHERE id = ?`).get(facilityId)?.name || '';

  // Who referred — default to the logged-in user.
  const byId = b.referred_by ? +b.referred_by : req.user.id;
  const byName = b.referred_by_name || db.prepare(`SELECT name FROM users WHERE id = ?`).get(byId)?.name || req.user.name;

  const info = db.prepare(`INSERT INTO outbound_referrals
    (ref_date, category, department, referred_by, referred_by_name, client_id, person_ref, facility_id, facility_name, loc_needed, reason, reason_detail, insurance, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    (b.ref_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    category, department, byId, byName,
    b.client_id ? +b.client_id : null, (b.person_ref || '').trim() || null,
    facilityId, facilityName || null, (b.loc_needed || '').trim() || null,
    b.reason.trim(), (b.reason_detail || '').trim() || null, (b.insurance || '').trim() || null,
    req.user.id);
  audit({ user: req.user, action: 'REFERRAL', entity: 'referral', entity_id: info.lastInsertRowid, detail: `${category} → ${facilityName} (${b.reason.trim()})`, ip: req.ip });
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/referrals/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM outbound_referrals WHERE id = ?`).run(req.params.id);
  audit({ user: req.user, action: 'DELETE', entity: 'referral', entity_id: +req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// Log an inbound referral by hand (when not syncing Salesforce).
app.post('/api/inbound-referrals', requireAuth, (req, res) => {
  const b = req.body || {}; const name = (b.facility_name || '').trim();
  if (!name && !b.facility_id) return res.status(400).json({ error: 'Name the referring partner.' });
  let facilityId = b.facility_id ? +b.facility_id : null, facilityName = name;
  if (!facilityId && name) {
    const f = db.prepare(`SELECT id FROM facilities WHERE name = ? COLLATE NOCASE`).get(name);
    facilityId = f ? f.id : db.prepare(`INSERT INTO facilities (name) VALUES (?)`).run(name).lastInsertRowid;
  }
  if (facilityId && !facilityName) facilityName = db.prepare(`SELECT name FROM facilities WHERE id = ?`).get(facilityId)?.name || '';
  db.prepare(`INSERT INTO inbound_referrals (ref_date, facility_id, facility_name, outcome) VALUES (?,?,?,?)`)
    .run((b.ref_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10), facilityId, facilityName || null, (b.outcome || 'pending'));
  res.json({ ok: true });
});

// Roll-up analytics: counters + breakdowns + weekly trend + reciprocity.
app.get('/api/referrals/summary', requireAuth, (req, res) => {
  const days = ({ '7': 7, '30': 30, '90': 90, '365': 365 })[String(req.query.range)] || 30;
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const cnt = (sql, ...a) => db.prepare(sql).get(...a)?.n ?? 0;
  const today = appToday();
  const week = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const month = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

  const counters = {
    today: cnt(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date = ?`, today),
    week: cnt(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date >= ?`, week),
    month: cnt(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date >= ?`, month),
    range: cnt(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date >= ?`, since),
  };
  const grp = (col) => db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM outbound_referrals WHERE ref_date >= ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC`).all(since);
  const byReason = grp('reason');
  const byDestination = grp('facility_name');
  const byReferrer = grp('referred_by_name');
  const byDepartment = grp('department');
  const byCategory = grp('category');

  // Weekly trend — last 8 weeks of outbound counts (oldest→newest) for a sparkline.
  const trend = [];
  for (let w = 7; w >= 0; w--) {
    const a = new Date(Date.now() - (w * 7 + 6) * 864e5).toISOString().slice(0, 10);
    const b = new Date(Date.now() - w * 7 * 864e5).toISOString().slice(0, 10);
    trend.push(cnt(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date >= ? AND ref_date <= ?`, a, b));
  }

  // Reciprocity: per partner, sent vs received (within range), with net + flag.
  const reciprocity = db.prepare(`
    SELECT f.id, f.name,
      (SELECT COUNT(*) FROM outbound_referrals o WHERE o.facility_id = f.id AND o.ref_date >= ?) AS sent,
      (SELECT COUNT(*) FROM inbound_referrals i WHERE i.facility_id = f.id AND i.ref_date >= ?) AS received
    FROM facilities f WHERE f.active = 1`).all(since, since)
    .filter((r) => r.sent || r.received)
    .map((r) => ({ ...r, net: r.sent - r.received }))
    .sort((a, b) => (b.sent + b.received) - (a.sent + a.received));

  res.json({ rangeDays: days, counters, byReason, byDestination, byReferrer, byDepartment, byCategory, trend, reciprocity, salesforce: sfConfigured() });
});

// AI: why people are leaving + BD relationship read. De-identified aggregates only.
app.get('/api/referrals/insights', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured.' });
  const days = ({ '7': 7, '30': 30, '90': 90, '365': 365 })[String(req.query.range)] || 90;
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const list = (col, label) => {
    const rows = db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM outbound_referrals WHERE ref_date >= ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC`).all(since);
    return `${label}:\n` + (rows.length ? rows.map((r) => `  - ${r.k}: ${r.n}`).join('\n') : '  (none)') + '\n';
  };
  const recip = db.prepare(`
    SELECT f.name,
      (SELECT COUNT(*) FROM outbound_referrals o WHERE o.facility_id = f.id AND o.ref_date >= ?) AS sent,
      (SELECT COUNT(*) FROM inbound_referrals i WHERE i.facility_id = f.id AND i.ref_date >= ?) AS received
    FROM facilities f WHERE f.active = 1`).all(since, since).filter((r) => r.sent || r.received);
  const total = db.prepare(`SELECT COUNT(*) n FROM outbound_referrals WHERE ref_date >= ?`).get(since).n;
  const ctx = `Outbound-referral data for the last ${days} days. Total outbound: ${total}.\n\n` +
    list('reason', 'By reason') + '\n' + list('category', 'By type (discharge/transfer/declined)') + '\n' +
    list('facility_name', 'By destination facility') + '\n' + list('department', 'By department') + '\n' +
    list('referred_by_name', 'By employee') + '\n' +
    'Partner reciprocity (we sent ↔ they sent us):\n' +
    (recip.length ? recip.map((r) => `  - ${r.name}: sent ${r.sent}, received ${r.received}, net ${r.sent - r.received}`).join('\n') : '  (no partner data yet)');
  try {
    const brief = await generateReferralInsights(ctx);
    audit({ user: req.user, action: 'REFERRAL_INSIGHTS', ip: req.ip });
    res.json({ brief });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Salesforce (referral reciprocity sync) ---------------- */
app.get('/api/salesforce/status', requireAuth, requireAdmin, (req, res) => res.json({ configured: sfConfigured() }));
app.get('/api/salesforce/config', requireAuth, requireAdmin, (req, res) => res.json(sfStatus()));
app.post('/api/salesforce/config', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  const set = (k, v) => { if (v !== undefined) setState('sf_' + k, (v == null ? '' : String(v)).trim()); };
  set('instance_url', b.instance_url); set('client_id', b.client_id); set('api_version', b.api_version);
  if (b.client_secret) set('client_secret', b.client_secret);   // only overwrite if provided
  audit({ user: req.user, action: 'SF_CONFIG', ip: req.ip });
  res.json({ ok: true, status: sfStatus() });
});
app.post('/api/salesforce/test', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await sfTest()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/salesforce/sync', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await sfSyncInbound(db); audit({ user: req.user, action: 'SF_SYNC', detail: `${r.leads} leads, ${r.matched} matched`, ip: req.ip }); res.json(r); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
// Schema discovery — list candidate objects, then describe one's fields.
app.get('/api/salesforce/discover', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await sfDiscover()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/salesforce/describe', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await sfDescribe(req.query.object)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/salesforce/automap', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await sfAutomap()); } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Front-desk arrivals board ---------------- */
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// Flip expected arrivals to "arrived" when a matching Kipu admission appears.
// Match by name (+DOB when both have it), tied to this scheduled event by admit
// date. Skips rows the front desk already decided. Returns how many flipped.
function reconcileArrivals() {
  const rows = db.prepare(`SELECT * FROM expected_arrivals WHERE status='expected' AND scheduled_date >= date('now','-14 day')`).all();
  if (!rows.length) return { matched: 0 };
  const clients = db.prepare(`SELECT id, name, dob, admit FROM clients WHERE admit IS NOT NULL AND admit != ''`).all();
  const mark = db.prepare(`UPDATE expected_arrivals SET status='arrived', arrived_at=datetime('now'), auto=1, client_id=?, updated_at=datetime('now') WHERE id=?`);
  let matched = 0;
  for (const a of rows) {
    const full = normName(`${a.first_name || ''} ${a.last_name || ''}`);
    const f = normName(a.first_name), l = normName(a.last_name);
    const dob = (a.dob || '').slice(0, 10);
    const m = clients.find((c) => {
      const cn = normName(c.name);
      const nameOk = cn === full || (f && l && cn.includes(f) && cn.includes(l));
      if (!nameOk) return false;
      if (dob && c.dob && (c.dob || '').slice(0, 10) !== dob) return false;
      if (a.scheduled_date && c.admit && c.admit.slice(0, 10) < addDays(a.scheduled_date, -2)) return false;
      return true;
    });
    if (m) { mark.run(m.id, a.id); matched++; }
  }
  return { matched };
}
// At cutoff: anyone still "expected" for a past day didn't show — flag for follow-up.
function markNoShows() {
  const today = appToday();
  return db.prepare(`UPDATE expected_arrivals SET status='no_show', updated_at=datetime('now') WHERE status='expected' AND scheduled_date < ?`).run(today).changes;
}

// Pull from Salesforce, then reconcile against Kipu admits.
app.post('/api/arrivals/sync', requireAuth, async (req, res) => {
  try {
    if (!sfConfigured()) return res.status(400).json({ error: 'Salesforce not connected.' });
    const r = await sfSyncArrivals(db);
    const rec = reconcileArrivals();
    audit({ user: req.user, action: 'ARRIVALS_SYNC', detail: `${r.pulled} pulled, ${rec.matched} arrived`, ip: req.ip });
    res.json({ ...r, ...rec });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Today's (or a given day's) board, split by status.
app.get('/api/arrivals', requireAuth, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : appToday();
  reconcileArrivals(); // keep it live without waiting on a sync
  const day = db.prepare(`SELECT * FROM expected_arrivals WHERE scheduled_date = ? ORDER BY status, last_name, first_name`).all(date);
  // Upcoming (future scheduled, still expected) — the Salesforce-driven pipeline.
  const upcoming = db.prepare(`SELECT * FROM expected_arrivals WHERE scheduled_date > ? AND scheduled_date <= date(?, '+21 day') AND status = 'expected' ORDER BY scheduled_date, last_name`).all(date, date);
  // Outstanding no-shows from the last 14 days for the follow-up queue.
  const followUps = db.prepare(`SELECT * FROM expected_arrivals WHERE status='no_show' AND scheduled_date >= date('now','-14 day') ORDER BY scheduled_date DESC`).all();
  const counts = { expected: 0, arrived: 0, no_show: 0, cancelled: 0 };
  for (const a of day) counts[a.status] = (counts[a.status] || 0) + 1;
  // Admitted in Kipu on this date but never on the schedule — a front-door gap.
  const admitsToday = db.prepare(`SELECT id, pref, name, room, program, loc, referral_source FROM clients WHERE substr(admit,1,10) = ? ORDER BY name`).all(date);
  const matchedIds = new Set(db.prepare(`SELECT client_id FROM expected_arrivals WHERE client_id IS NOT NULL`).all().map((r) => r.client_id));
  const schedNames = new Set(db.prepare(`SELECT first_name, last_name FROM expected_arrivals WHERE scheduled_date >= date(?, '-3 day')`).all(date).map((a) => normName(`${a.first_name || ''} ${a.last_name || ''}`)));
  const unscheduled = admitsToday.filter((c) => !matchedIds.has(c.id) && !schedNames.has(normName(c.name)))
    .map((c) => ({ id: c.id, name: c.pref || c.name, room: c.room || '', loc: c.loc && c.loc !== 'Unspecified' ? c.loc : (c.program || ''), referral: c.referral_source || '' }));
  res.json({ date, arrivals: day, counts, upcoming, followUps, unscheduled, configured: sfConfigured() });
});
// Front-desk action: arrived / no_show / cancelled (+ optional follow-up note).
app.post('/api/arrivals/:id/status', requireAuth, (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['expected', 'arrived', 'no_show', 'cancelled'].includes(status)) return res.status(400).json({ error: 'bad status' });
  const arrivedAt = status === 'arrived' ? "datetime('now')" : 'arrived_at';
  db.prepare(`UPDATE expected_arrivals SET status=?, follow_up=COALESCE(?, follow_up), arrived_at=${arrivedAt}, auto=0, updated_at=datetime('now') WHERE id=?`)
    .run(status, req.body?.follow_up != null ? String(req.body.follow_up) : null, req.params.id);
  audit({ user: req.user, action: 'ARRIVAL_STATUS', detail: `#${req.params.id} -> ${status}`, ip: req.ip });
  res.json({ ok: true });
});
// Welcome TV board: just the greet-able names for today (first name + last initial).
app.get('/api/arrivals/board', requireAuth, (req, res) => {
  reconcileArrivals();
  const today = appToday();
  const rows = db.prepare(`SELECT first_name, last_name, preferred_name, status FROM expected_arrivals WHERE scheduled_date = ? AND status IN ('expected','arrived') ORDER BY status DESC, first_name`).all(today);
  const greet = (a) => {
    const first = (a.preferred_name || a.first_name || '').trim();
    const li = (a.last_name || '').trim().slice(0, 1);
    return { name: li ? `${first} ${li}.` : first, arrived: a.status === 'arrived' };
  };
  res.json({ date: today, facility: getState('facility_name') || 'Armada Recovery', names: rows.map(greet) });
});

/* ---------------- Risk & outcome analytics ---------------- */
// Computes length-of-stay (LOS) and AMA patterns across time-of-admit
// dimensions and staff attribution, plus the biggest active risks and a queue of
// discharges still missing where/why (the manual-fallback when Kipu can't fill it).
function buildAnalytics(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT id, admit, admit_time, discharge_status, discharge_date, therapist, case_manager, referral_source
    FROM clients WHERE admit IS NOT NULL AND admit != '' AND discharge_date IS NOT NULL AND discharge_date >= ?`).all(since);

  // Experience score per client (avg of scale answers on the experience survey).
  const expSurvey = db.prepare(`SELECT id FROM surveys WHERE key = 'experience'`).get();
  const expByClient = {};
  if (expSurvey) {
    db.prepare(`SELECT r.client_id cid, AVG(a.value_num) avg FROM survey_responses r
      JOIN survey_answers a ON a.response_id = r.id
      WHERE r.survey_id = ? AND a.value_num IS NOT NULL GROUP BY r.client_id`).all(expSurvey.id)
      .forEach((x) => { if (x.cid) expByClient[x.cid] = x.avg; });
  }

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const losOf = (a, d) => { const ms = new Date(d + 'T00:00') - new Date(a + 'T00:00'); return ms >= 0 ? Math.round(ms / 864e5) : null; };
  const timeBucket = (t) => { if (!t) return 'Unknown'; const h = +String(t).slice(0, 2); if (isNaN(h)) return 'Unknown'; return h < 6 ? 'Overnight (12–6a)' : h < 12 ? 'Morning (6a–12p)' : h < 18 ? 'Afternoon (12–6p)' : 'Evening (6p–12a)'; };
  const domBucket = (a) => { const d = +a.slice(8, 10); return d <= 10 ? 'Early (1–10)' : d <= 20 ? 'Mid (11–20)' : 'Late (21–31)'; };

  const mk = () => ({});
  const add = (map, key, los, ama) => { const m = map[key] || (map[key] = { n: 0, losSum: 0, losN: 0, ama: 0 }); m.n++; if (los != null) { m.losSum += los; m.losN++; } if (ama) m.ama++; };
  const byDow = mk(), byTime = mk(), byDom = mk(), byTher = mk(), byCM = mk(), bySource = mk();
  const expTher = {};
  let total = 0, amaTotal = 0, losSum = 0, losN = 0;
  for (const r of rows) {
    const los = losOf(r.admit, r.discharge_date); const ama = r.discharge_status === 'AMA';
    total++; if (ama) amaTotal++; if (los != null) { losSum += los; losN++; }
    add(byDow, DOW[new Date(r.admit + 'T00:00').getDay()], los, ama);
    add(byTime, timeBucket(r.admit_time), los, ama);
    add(byDom, domBucket(r.admit), los, ama);
    if (r.therapist) { add(byTher, r.therapist, los, ama); if (expByClient[r.id] != null) { const e = expTher[r.therapist] || (expTher[r.therapist] = { sum: 0, n: 0 }); e.sum += expByClient[r.id]; e.n++; } }
    if (r.case_manager) add(byCM, r.case_manager, los, ama);
    if (r.referral_source && r.referral_source.trim()) add(bySource, r.referral_source.trim(), los, ama);
  }
  const fmt = (map) => Object.entries(map).map(([k, m]) => ({ key: k, n: m.n, avgLos: m.losN ? +(m.losSum / m.losN).toFixed(1) : null, ama: m.ama, amaRate: m.n ? Math.round(m.ama / m.n * 100) : 0 })).sort((a, b) => b.n - a.n);
  const staff = (map) => fmt(map).map((s) => ({ ...s, exp: expTher[s.key] ? +(expTher[s.key].sum / expTher[s.key].n).toFixed(2) : null }));
  const dowArr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => { const m = byDow[d]; return { key: d, n: m ? m.n : 0, avgLos: m && m.losN ? +(m.losSum / m.losN).toFixed(1) : null, ama: m ? m.ama : 0, amaRate: m && m.n ? Math.round(m.ama / m.n * 100) : 0 }; });

  const risk = db.prepare(`SELECT id, pref, name, room FROM clients WHERE active = 1 AND discharge_status IS NULL`).all()
    .map((c) => { const a = latestAmaRead(c.id); return a && a.level !== 'Low' ? { id: c.id, name: c.pref || c.name, room: c.room, level: a.level, summary: a.summary } : null; })
    .filter(Boolean).sort((a, b) => (b.level === 'High') - (a.level === 'High'));

  const missingDischarge = db.prepare(`SELECT id, pref, name, discharge_status, discharge_date FROM clients
    WHERE discharge_date IS NOT NULL AND discharge_date >= ?
      AND ((discharge_reason IS NULL OR discharge_reason = '') OR (discharge_destination IS NULL OR discharge_destination = ''))
    ORDER BY discharge_date DESC LIMIT 50`).all(since);

  // Which referral sources work best: inbound referrals by facility, with how
  // many we actually admitted (conversion). The clearest signal we have today.
  const byReferralSource = db.prepare(`SELECT COALESCE(NULLIF(facility_name,''),'(unspecified)') k,
      COUNT(*) n,
      SUM(CASE WHEN lower(outcome)='admitted' THEN 1 ELSE 0 END) admitted
    FROM inbound_referrals WHERE ref_date >= ? GROUP BY k ORDER BY n DESC LIMIT 12`).all(since)
    .map((r) => ({ key: r.k, n: r.n, admitted: r.admitted, admitRate: r.n ? Math.round(r.admitted / r.n * 100) : 0 }));

  return {
    rangeDays: days, sampleSize: total,
    totals: { discharges: total, amaRate: total ? Math.round(amaTotal / total * 100) : 0, avgLos: losN ? +(losSum / losN).toFixed(1) : null },
    byDow: dowArr, byTime: fmt(byTime), byDom: fmt(byDom),
    byTherapist: staff(byTher), byCaseManager: staff(byCM),
    byReferralSource,                 // inbound conversion (admitted vs declined)
    bySourceOutcome: fmt(bySource),   // retention by source (avg stay + AMA rate)
    risk, missingDischarge,
  };
}

app.get('/api/analytics', requireAuth, (req, res) => {
  const days = ({ '90': 90, '180': 180, '365': 365, '730': 730 })[String(req.query.range)] || 365;
  res.json(buildAnalytics(days));
});

// Fill the gap Kipu couldn't: where/why a client went. Manual fallback only.
app.post('/api/clients/:id/discharge-info', requireAuth, (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE clients SET discharge_destination = COALESCE(?, discharge_destination), discharge_reason = COALESCE(?, discharge_reason) WHERE id = ?`)
    .run(b.destination || null, b.reason || null, req.params.id);
  audit({ user: req.user, action: 'DISCHARGE_INFO', entity: 'client', entity_id: +req.params.id, ip: req.ip });
  res.json({ ok: true });
});

app.get('/api/analytics/insights', requireAuth, async (req, res) => {
  if (!claudeConfigured()) return res.status(503).json({ error: 'Claude is not configured.' });
  const a = buildAnalytics(({ '90': 90, '180': 180, '365': 365, '730': 730 })[String(req.query.range)] || 365);
  if (a.sampleSize < 3) return res.json({ brief: `Only ${a.sampleSize} completed stays in this window — not enough to read patterns yet. The analysis turns on automatically as discharges accumulate (or once Kipu backfills history).` });
  const line = (rows) => rows.map((r) => `  - ${r.key}: ${r.n} stays, avg LOS ${r.avgLos ?? '—'}d, AMA ${r.amaRate}%`).join('\n');
  const staffLine = (rows) => rows.map((r) => `  - ${r.key}: ${r.n} clients, avg LOS ${r.avgLos ?? '—'}d, AMA ${r.amaRate}%${r.exp != null ? `, experience ${r.exp}/5` : ''}`).join('\n');
  const ctx = `Length-of-stay (LOS) & AMA analytics, last ${a.rangeDays} days. ${a.totals.discharges} completed stays. Overall AMA ${a.totals.amaRate}%, avg LOS ${a.totals.avgLos}d.\n\n` +
    `By day of week admitted:\n${line(a.byDow)}\n\nBy time of admit:\n${line(a.byTime)}\n\nBy day-of-month admitted:\n${line(a.byDom)}\n\n` +
    `By therapist:\n${staffLine(a.byTherapist) || '  (no therapist attribution yet)'}\n\nBy case manager:\n${staffLine(a.byCaseManager) || '  (none)'}`;
  try {
    const brief = await generateOutcomeInsights(ctx);
    audit({ user: req.user, action: 'ANALYTICS_INSIGHTS', ip: req.ip });
    res.json({ brief });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/* ---------------- Scheduling & workforce ---------------- */
// The schedule for a date: each slot with assignments, plus live coverage
// (needed vs scheduled vs called-off vs currently clocked-in).
app.get('/api/staffing', requireAuth, (req, res) => {
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const slots = db.prepare(`SELECT * FROM schedule_slots WHERE date = ? ORDER BY
    CASE part WHEN 'Morning' THEN 0 WHEN 'Day' THEN 1 WHEN 'Evening' THEN 2 WHEN 'Night' THEN 3 ELSE 4 END, role`).all(date);
  const getA = db.prepare(`SELECT * FROM schedule_assignments WHERE slot_id = ? ORDER BY id`);
  // Who is clocked in right now (open punch today).
  const onNow = new Set(db.prepare(`SELECT user_id FROM time_entries WHERE clock_out IS NULL AND date(clock_in) = date('now')`).all().map((r) => r.user_id));
  const out = slots.map((s) => {
    const a = getA.all(s.id);
    const scheduled = a.filter((x) => x.status === 'scheduled');
    const calledOff = a.filter((x) => x.status === 'called_off');
    const present = scheduled.filter((x) => onNow.has(x.user_id)).length;
    return { ...s, assignments: a, scheduledCount: scheduled.length, calledOffCount: calledOff.length, present, covered: scheduled.length >= s.needed };
  });
  res.json({ date, slots: out });
});
app.post('/api/staffing/slots', requireAuth, requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.date || !b.part || !b.role) return res.status(400).json({ error: 'date, part, role required' });
  const info = db.prepare(`INSERT INTO schedule_slots (date, part, role, needed, notes, created_by) VALUES (?,?,?,?,?,?)`)
    .run(b.date.slice(0, 10), b.part, b.role, Math.max(1, +b.needed || 1), b.notes || null, req.user.id);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/staffing/slots/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM schedule_slots WHERE id = ?`).run(req.params.id); res.json({ ok: true });
});
app.post('/api/staffing/slots/:id/assign', requireAuth, requireAdmin, (req, res) => {
  const u = db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(+req.body?.user_id);
  if (!u) return res.status(400).json({ error: 'Unknown staff member' });
  db.prepare(`INSERT INTO schedule_assignments (slot_id, user_id, user_name) VALUES (?,?,?)`).run(req.params.id, u.id, u.name);
  res.json({ ok: true });
});
app.delete('/api/staffing/assignments/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM schedule_assignments WHERE id = ?`).run(req.params.id); res.json({ ok: true });
});
app.post('/api/staffing/assignments/:id/calloff', requireAuth, (req, res) => {
  const a = db.prepare(`SELECT a.*, s.date, s.part, s.role FROM schedule_assignments a JOIN schedule_slots s ON s.id=a.slot_id WHERE a.id = ?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE schedule_assignments SET status='called_off', calloff_reason=?, calloff_at=datetime('now') WHERE id = ?`).run(req.body?.reason || null, req.params.id);
  // Flag the coverage gap to the on-call leader.
  const open = db.prepare(`SELECT s.needed - (SELECT COUNT(*) FROM schedule_assignments x WHERE x.slot_id=s.id AND x.status='scheduled') AS gap FROM schedule_slots s WHERE s.id=?`).get(a.slot_id);
  if (open && open.gap > 0) createAlert(null, 'coverage', 'Elevated', `Call-off: ${a.user_name} for ${a.date} ${a.part} ${a.role}. Coverage short by ${open.gap}.`);
  audit({ user: req.user, action: 'CALLOFF', entity: 'assignment', entity_id: +req.params.id, detail: `${a.user_name} ${a.date} ${a.part}`, ip: req.ip });
  res.json({ ok: true });
});

// In-app time clock (default until an external system is connected).
app.get('/api/clock/status', requireAuth, (req, res) => {
  const mine = db.prepare(`SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1`).get(req.user.id);
  const onNow = db.prepare(`SELECT user_id, user_name, clock_in FROM time_entries WHERE clock_out IS NULL ORDER BY clock_in`).all();
  res.json({ clockedIn: !!mine, since: mine?.clock_in || null, onNow });
});
app.post('/api/clock/in', requireAuth, (req, res) => {
  const open = db.prepare(`SELECT id FROM time_entries WHERE user_id = ? AND clock_out IS NULL`).get(req.user.id);
  if (open) return res.json({ ok: true, already: true });
  db.prepare(`INSERT INTO time_entries (user_id, user_name) VALUES (?,?)`).run(req.user.id, req.user.name);
  audit({ user: req.user, action: 'CLOCK_IN', ip: req.ip });
  res.json({ ok: true });
});
app.post('/api/clock/out', requireAuth, (req, res) => {
  db.prepare(`UPDATE time_entries SET clock_out = datetime('now') WHERE user_id = ? AND clock_out IS NULL`).run(req.user.id);
  audit({ user: req.user, action: 'CLOCK_OUT', ip: req.ip });
  res.json({ ok: true });
});

// Safety rounds + job-duty completions.
app.get('/api/rounds/today', requireAuth, (req, res) => {
  res.json({ rounds: db.prepare(`SELECT * FROM rounds WHERE date(ts) = date('now') ORDER BY ts DESC`).all() });
});
app.post('/api/rounds', requireAuth, (req, res) => {
  db.prepare(`INSERT INTO rounds (by_id, by_name, area, note) VALUES (?,?,?,?)`).run(req.user.id, req.user.name, req.body?.area || null, req.body?.note || null);
  res.json({ ok: true });
});
app.post('/api/duties', requireAuth, (req, res) => {
  if (!(req.body?.text || '').trim()) return res.status(400).json({ error: 'What was done?' });
  db.prepare(`INSERT INTO duty_logs (date, part, role, text, by_id, by_name) VALUES (date('now'),?,?,?,?,?)`)
    .run(req.body.part || null, req.body.role || null, req.body.text.trim(), req.user.id, req.user.name);
  res.json({ ok: true });
});

// Workforce dashboard: on now, coverage today, call-off patterns, rounds/duties.
app.get('/api/workforce/summary', requireAuth, (req, res) => {
  const days = ({ '30': 30, '90': 90 })[String(req.query.range)] || 30;
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const today = appToday();
  const onNow = db.prepare(`SELECT user_name, clock_in FROM time_entries WHERE clock_out IS NULL ORDER BY clock_in`).all();
  // Today coverage roll-up.
  const slotsToday = db.prepare(`SELECT s.id, s.needed,
    (SELECT COUNT(*) FROM schedule_assignments a WHERE a.slot_id=s.id AND a.status='scheduled') AS sched
    FROM schedule_slots s WHERE s.date = ?`).all(today);
  const needed = slotsToday.reduce((n, s) => n + s.needed, 0);
  const scheduled = slotsToday.reduce((n, s) => n + s.sched, 0);
  const gaps = slotsToday.filter((s) => s.sched < s.needed).length;
  // Call-off patterns.
  const byPerson = db.prepare(`SELECT user_name k, COUNT(*) n FROM schedule_assignments a JOIN schedule_slots s ON s.id=a.slot_id
    WHERE a.status='called_off' AND s.date >= ? GROUP BY user_name ORDER BY n DESC`).all(since);
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calloffRows = db.prepare(`SELECT s.date FROM schedule_assignments a JOIN schedule_slots s ON s.id=a.slot_id WHERE a.status='called_off' AND s.date >= ?`).all(since);
  const byDow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({ k: d, n: 0 }));
  calloffRows.forEach((r) => { const d = dowNames[new Date(r.date + 'T00:00').getDay()]; const e = byDow.find((x) => x.k === d); if (e) e.n++; });
  const roundsToday = db.prepare(`SELECT COUNT(*) n FROM rounds WHERE date(ts) = date('now')`).get().n;
  const dutiesToday = db.prepare(`SELECT COUNT(*) n FROM duty_logs WHERE date = ?`).get(today).n;
  const calloffsWeek = db.prepare(`SELECT COUNT(*) n FROM schedule_assignments a JOIN schedule_slots s ON s.id=a.slot_id WHERE a.status='called_off' AND s.date >= ?`).get(new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)).n;
  res.json({
    onNow, coverage: { needed, scheduled, gaps, pct: needed ? Math.round(scheduled / needed * 100) : null },
    calloffsWeek, byPerson, byDow, roundsToday, dutiesToday,
  });
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
  const today = appToday();
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
  const today = appToday();
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
  surveyRecovery(req.body.client_id, answers);   // bad feedback → instant service recovery
  audit({ user: req.user, action: 'SURVEY', entity: 'survey', entity_id: survey.id, detail: req.body.client_id ? 'client ' + req.body.client_id : 'anonymous', ip: req.ip });
  res.json({ ok: true });
});
// Close the loop on the voice of the guest: a low score (or a 1-2 on any item)
// raises a service-recovery alert so a leader checks in immediately.
function surveyRecovery(clientId, answers) {
  if (!clientId || !Array.isArray(answers)) return;
  const nums = answers.map((a) => ((a.num === 0 || a.num) ? Number(a.num) : null)).filter((n) => n != null && !Number.isNaN(n));
  if (!nums.length) return;
  const avg = nums.reduce((s, n) => s + n, 0) / nums.length;
  const low = nums.some((n) => n <= 2);
  if (avg > 3 && !low) return;
  const c = db.prepare(`SELECT pref, name FROM clients WHERE id = ?`).get(clientId);
  const nm = c ? (c.pref || c.name) : ('client ' + clientId);
  createAlert(clientId, 'recovery', (avg <= 2 || low) ? 'High' : 'Elevated', `${nm} — low experience score (${avg.toFixed(1)}/5). Service recovery: a leader should check in now.`);
}

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
  // De-dupe: keep only the latest alert per client + kind so the panel stays clean.
  const sub = status === 'all'
    ? `SELECT MAX(id) FROM alerts GROUP BY client_id, kind`
    : `SELECT MAX(id) FROM alerts WHERE status = ? GROUP BY client_id, kind`;
  const where = status === 'all' ? `WHERE a.id IN (${sub})` : `WHERE a.status = ? AND a.id IN (${sub})`;
  const args = status === 'all' ? [] : [status, status];
  const rows = db.prepare(`SELECT a.*, c.pref FROM alerts a LEFT JOIN clients c ON c.id = a.client_id ${where} ORDER BY a.id DESC LIMIT 100`).all(...args);
  const newCount = db.prepare(`SELECT COUNT(*) n FROM (SELECT MAX(id) FROM alerts WHERE status = 'New' GROUP BY client_id, kind)`).get().n;
  res.json({ alerts: rows, newCount });
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
  const today = appToday();
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
function kioskOk(req) {
  const got = String(req.query.code || req.body?.code || ''), want = String(kioskCode());
  if (!got || got.length !== want.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}
app.get('/api/kiosk/data', (req, res) => {
  if (!kioskOk(req)) return res.status(401).json({ error: 'Invalid kiosk code' });
  const surveys = db.prepare(`SELECT id, key, title, description FROM surveys WHERE active = 1 AND key IN ('experience','meals') ORDER BY sort`).all();
  for (const s of surveys) s.questions = db.prepare(`SELECT id, category, text, type FROM survey_questions WHERE survey_id = ? ORDER BY sort, id`).all(s.id);
  res.json({
    // The kiosk is on the unit and only weakly authenticated — expose preferred
    // name + room only, never the full legal name.
    clients: db.prepare(`SELECT id, pref, room FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, pref`).all(),
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
  surveyRecovery(b.client_id, b.answers);   // the guest spoke — recover instantly if it's low
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
  const today = appToday();
  const f = focusForDate(today);
  const logs = db.prepare(`SELECT user_name, note FROM focus_logs WHERE date = ? ORDER BY id DESC`).all(today);
  res.json({ topic: f.t, goal: f.g, participants: logs.length, logs, joined: !!db.prepare(`SELECT 1 FROM focus_logs WHERE date = ? AND user_id = ?`).get(today, req.user.id), options: FOCUS_TOPICS });
});
app.post('/api/focus', requireAuth, (req, res) => {
  const today = appToday();
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
  audit({ user: req.user, action: 'VIEW', entity: 'client', entity_id: +req.params.id, detail: 'notes', ip: req.ip });
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

// Keep the roster current automatically: re-sync the live Kipu census on a
// schedule (default every 6h) so admits/discharges flow in without a manual
// rebuild. Set KIPU_SYNC_HOURS=0 to disable. Optionally KIPU_AUTO_ASSESS=true
// runs the risk assessment after each sync.
if (kipuConfigured()) {
  const hrs = process.env.KIPU_SYNC_HOURS != null ? +process.env.KIPU_SYNC_HOURS : 6;
  if (hrs > 0) {
    const autoSync = async () => {
      try {
        const r = await kipuSyncRoster();
        console.log(`[kipu] auto-sync: ${r.activeNow} active (${r.created} new, ${r.deactivated} discharged)`);
        try { ensureDignityKits(); } catch (e) { /* non-fatal */ }
        // Re-assess the census automatically (clears stale alerts + refreshes every
        // client's clean read/snapshot). Disable with KIPU_AUTO_ASSESS=false.
        if (claudeConfigured() && process.env.KIPU_AUTO_ASSESS !== 'false' && !assessJob.running) {
          await runAssessAll({ id: null, name: 'Auto-sync' }, { incremental: true });
        }
        // Anyone newly discharged gets an automatic "what could we do better" debrief.
        if (claudeConfigured() && !debriefJob.running) runDischargeDebriefs({ id: null, name: 'Auto-sync' }).catch((e) => { debriefJob.running = false; console.error('[debrief]', e.message); });
      } catch (e) { console.error('[kipu] auto-sync failed:', e.message); }
    };
    setTimeout(autoSync, 30000);                 // first run shortly after boot
    setInterval(autoSync, hrs * 3600 * 1000);    // then on the interval
  }
}

// ---- Daily cutoff: at LOCAL midnight, finalize the day just ended and open a
// fresh one, so each day's intakes/discharges/LOC-changes/AMA is a fixed record.
function msUntilLocalMidnight() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',
    { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]));
  let h = parts.hour === 24 ? 0 : parts.hour;  // some engines render midnight as 24
  const secsIntoDay = h * 3600 + parts.minute * 60 + parts.second;
  return (86400 - secsIntoDay) * 1000 + 5000;  // 5s after midnight, safely past the boundary
}
function runDailyCutoff() {
  try {
    const today = appToday();
    const yesterday = addDays(today, -1);
    rollupDailyMetrics(yesterday);   // finalize the day that just ended
    rollupDailyMetrics(today);       // open today's fresh record
    db.prepare(`DELETE FROM command_checklist WHERE date < date(?, '-14 day')`).run(today); // tidy old checklists
    const noShows = markNoShows();   // scheduled-but-never-admitted -> follow-up queue
    if (noShows) console.log(`[cutoff] ${noShows} no-show(s) flagged for follow-up`);
    try { ensureDignityKits(); runFlowAutomations(); } catch (e) { console.error('[cutoff] automations:', e.message); }
    // Refresh tomorrow's expected arrivals from Salesforce for the front-desk board.
    if (sfConfigured()) sfSyncArrivals(db).then(() => reconcileArrivals()).catch((e) => console.error('[cutoff] arrivals sync:', e.message));
    console.log(`[cutoff] daily report finalized for ${yesterday} (${APP_TZ})`);
    // Email the midnight census to the distribution list (replaces the manual one).
    sendCensusEmail().then((r) => { if (r.sent) console.log('[cutoff] census emailed to', r.to); }).catch((e) => console.error('[cutoff] census email:', e.message));
  } catch (e) { console.error('[cutoff] failed:', e.message); }
  setTimeout(runDailyCutoff, msUntilLocalMidnight());  // re-arm for the next midnight
}
setTimeout(runDailyCutoff, msUntilLocalMidnight());

// ---- Morning leadership brief: the day's numbers, emailed before the shift ----
function msUntilLocalHour(targetHour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',
    { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]));
  const h = parts.hour === 24 ? 0 : parts.hour;
  const secsIntoDay = h * 3600 + parts.minute * 60 + parts.second;
  let delta = targetHour * 3600 - secsIntoDay;
  if (delta <= 0) delta += 86400;
  return delta * 1000 + 5000;
}
function buildMorningBrief() {
  const today = appToday();
  const active = db.prepare(`SELECT * FROM clients WHERE active = 1 AND discharge_status IS NULL ORDER BY room, name`).all();
  const byLoc = {};
  for (const c of active) { const k = (c.loc && c.loc !== 'Unspecified') ? c.loc : (parseLoc(c.program) || 'Unspecified'); byLoc[k] = (byLoc[k] || 0) + 1; }
  const admitsToday = active.filter((c) => (c.admit || '').slice(0, 10) === today).length;
  const dToday = db.prepare(`SELECT pref, name, discharge_status FROM clients WHERE substr(discharge_date,1,10) = ?`).all(today);
  const amaToday = dToday.filter((d) => /ama|against medical/i.test(d.discharge_status || '')).length;
  const atRisk = active.map((c) => ({ c, a: latestAmaRead(c.id) })).filter((x) => x.a && (x.a.level === 'High' || x.a.level === 'Elevated'));
  const scheduled = db.prepare(`SELECT preferred_name, first_name, last_name FROM expected_arrivals WHERE scheduled_date = ? AND status = 'expected'`).all(today);
  const delightSet = new Set(db.prepare(`SELECT DISTINCT client_id FROM delights WHERE client_id IS NOT NULL`).all().map((r) => r.client_id));
  let welcomed = 0, anticipated = 0, ccInc = 0;
  for (const c of active) { if (careCardStatus(c).complete) welcomed++; else ccInc++; if (delightSet.has(c.id)) anticipated++; }
  const served = active.length ? Math.round((welcomed + anticipated) / (active.length * 2) * 100) : 100;
  const locLine = Object.entries(byLoc).sort((a, b) => (LOC_RANK[b[0]] ?? -1) - (LOC_RANK[a[0]] ?? -1)).map(([k, n]) => `${k}: ${n}`).join(' · ');
  const dt = new Date().toLocaleDateString('en-US', { timeZone: APP_TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const card = (label, val, color) => `<td style="padding:10px 14px;text-align:center;border:1px solid #eae5da;border-radius:8px"><div style="font-size:26px;font-weight:700;color:${color || '#235056'}">${val}</div><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6f7a75">${label}</div></td>`;
  const list = (arr, fmt) => arr.length ? arr.map(fmt).join('') : '<div style="color:#6f7a75">None.</div>';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#1b2825">
    <h2 style="color:#235056;margin:0 0 2px">Armada — Morning Brief</h2><div style="color:#6f7a75;margin-bottom:16px">${dt}</div>
    <table style="border-collapse:separate;border-spacing:8px"><tr>
      ${card('Census', active.length)}${card('Admits today', admitsToday)}${card('Discharges', dToday.length)}${card('AMA', amaToday, amaToday ? '#c06a52' : '#235056')}${card('Served %', served + '%', served >= 80 ? '#2f7a4f' : '#9a6a1f')}
    </tr></table>
    <p style="margin:14px 0 4px"><strong>By level of care:</strong> ${locLine || '—'}</p>
    <h3 style="color:#235056;margin:18px 0 6px">Watch today — at risk (${atRisk.length})</h3>
    ${list(atRisk, (x) => `<div>⚠ <strong>${esc(x.c.pref || x.c.name)}</strong>${x.c.room ? ' · ' + esc(x.c.room) : ''} — ${esc(x.a.level)}${x.a.best_play ? ': ' + esc(x.a.best_play) : ''}</div>`)}
    <h3 style="color:#235056;margin:18px 0 6px">Scheduled to arrive (${scheduled.length})</h3>
    ${list(scheduled, (s) => `<div>☀ ${esc(((s.preferred_name || s.first_name || '') + ' ' + (s.last_name || '')).trim())}</div>`)}
    <p style="margin:18px 0 0;color:#6f7a75">${ccInc} Care Card(s) to finish · Three Steps of Service at ${served}%.</p>
    <p style="margin:16px 0 0;font-size:12px;color:#9aa">Sent from Armada Care Standards. Open the app for the full Command Center.</p>
  </div>`;
  const text = `Armada Morning Brief — ${dt}\nCensus ${active.length} · Admits ${admitsToday} · Discharges ${dToday.length} · AMA ${amaToday} · Served ${served}%\nLOC: ${locLine}\nAt risk: ${atRisk.map((x) => (x.c.pref || x.c.name) + ' (' + x.a.level + ')').join('; ') || 'none'}\nScheduled: ${scheduled.map((s) => (s.preferred_name || s.first_name || '') + ' ' + (s.last_name || '')).join('; ') || 'none'}`;
  return { subject: `Armada Morning Brief — ${dt} · ${active.length} census, ${atRisk.length} at risk`, html, text };
}
async function sendMorningBrief() {
  const to = (getState('brief_email_to') || getState('census_email_to') || process.env.CENSUS_EMAIL_TO || '').trim();
  if (!emailConfigured()) return { sent: false, reason: 'email not connected' };
  if (!to) return { sent: false, reason: 'no recipients' };
  const b = buildMorningBrief();
  await sendEmail({ to, subject: b.subject, html: b.html, text: b.text });
  return { sent: true, to };
}
function runMorningBrief() {
  if (process.env.MORNING_BRIEF !== 'false') {
    sendMorningBrief().then((r) => { if (r.sent) console.log('[brief] morning brief emailed to', r.to); else console.log('[brief] skipped:', r.reason); }).catch((e) => console.error('[brief]', e.message));
  }
  setTimeout(runMorningBrief, msUntilLocalHour(+(process.env.MORNING_BRIEF_HOUR || 7)));
}
setTimeout(runMorningBrief, msUntilLocalHour(+(process.env.MORNING_BRIEF_HOUR || 7)));

// Keep the front-desk arrivals board fresh through the day (Salesforce pull +
// Kipu reconcile) without anyone clicking refresh.
setInterval(() => {
  if (!sfConfigured()) return;
  sfSyncArrivals(db).then(() => reconcileArrivals()).catch((e) => console.error('[arrivals] auto:', e.message));
}, 2 * 3600 * 1000);

// ---- Overdue-rounds escalation: when a client is past their check window
// (+grace), text the on-call leader. Opt-in (Rounds → escalation toggle), and
// de-duped so it texts at most hourly per client. ----
const roundsEscalated = new Map();   // client_id -> last escalation ms
function roundsEscalationSweep() {
  try {
    if (getState('rounds_escalation') === 'on' && (smsConfigured() || emailConfigured())) {
      const grace = +(process.env.ROUNDS_ESCALATE_GRACE || 20);
      const now = Date.now();
      const rows = db.prepare(`SELECT c.id, c.pref, c.name, c.room, c.obs_interval, (SELECT ts FROM obs_checks o WHERE o.client_id = c.id ORDER BY o.id DESC LIMIT 1) last FROM clients c WHERE c.active = 1 AND c.discharge_status IS NULL`).all();
      for (const c of rows) {
        const limit = (c.obs_interval || OBS_DEFAULT_MIN) + grace;
        const t = c.last ? Date.parse(String(c.last).replace(' ', 'T') + 'Z') : null;
        const mins = t ? Math.floor((now - t) / 60000) : 9999;
        if (mins <= limit) { roundsEscalated.delete(c.id); continue; }
        if (now - (roundsEscalated.get(c.id) || 0) < 60 * 60000) continue;   // at most hourly
        roundsEscalated.set(c.id, now);
        const name = c.pref || c.name;
        createAlert(c.id, 'rounds', 'High', `${name}${c.room ? ' (' + c.room + ')' : ''} — safety round OVERDUE (${mins}m since last check)`);
        notifyOnCall(`OVERDUE safety round: ${name}${c.room ? ' · Room ' + c.room : ''} — last checked ${mins} min ago. Go lay eyes on the client now.`);
      }
    }
  } catch (e) { console.error('[rounds-escalate]', e.message); }
  setTimeout(roundsEscalationSweep, (+(process.env.ROUNDS_ESCALATE_MIN || 15)) * 60000);
}
setTimeout(roundsEscalationSweep, 90000);

const PORT = process.env.PORT || 3000;
try { ensureDignityKits(); } catch (e) { /* dignity kits are best-effort at boot */ }
app.listen(PORT, () => console.log(`Armada Care Standards running on http://localhost:${PORT}`));

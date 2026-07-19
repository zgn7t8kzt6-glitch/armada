// FamilyOS Phase 1 — The Cockpit. Two owners, manual data, Goals + waterfall,
// Decision Engine, Rulebook/Constitution, audit log. See SPEC-PHASE1.md.
process.env.TZ = 'America/New_York'; // spec section 8

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q, migrate, audit } from './db.js';
import { seed } from './seed.js';
import {
  userCount, createUser, createSession, destroySession, sessionUser,
  login, totpSetup, totpCheck, issueRecoveryCodes, useRecoveryCode,
  recentlyAuthed, markReauth, verifyPassword, noteSuccess,
} from './auth.js';
import { allocate, dedupeHashes, ruleChangeEffectiveAt, parseCsv, parseMoney, fmtMoney } from './core.js';
import { computeKpis, weakestKpi } from './kpi.js';
import { buildDigest, sendDigest } from './digest.js';
import { plaidEnabled, createLinkToken, exchangePublicToken, syncAll, revokeAll, itemsOverview } from './plaid.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

const COOKIE = 'fos_session';
const isProd = process.env.NODE_ENV === 'production';

// ---- tiny cookie helpers ----
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setCookie(res, name, value, maxAgeSec) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isProd) bits.push('Secure');
  if (maxAgeSec != null) bits.push(`Max-Age=${maxAgeSec}`);
  res.append('Set-Cookie', bits.join('; '));
}

// ---- CSRF: SameSite=Strict cookies + same-origin check on writes ----
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers.origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try { if (new URL(req.headers.origin).host !== host) return res.status(403).send('cross-origin blocked'); }
    catch { return res.status(403).send('bad origin'); }
  }
  next();
});

// ---- auth context ----
app.use(async (req, res, next) => {
  req.user = await sessionUser(getCookie(req, COOKIE));
  res.locals.user = req.user;
  res.locals.fmt = fmtMoney;
  res.locals.path = req.path;
  next();
});

const OPEN_PATHS = ['/login', '/setup', '/totp', '/sw.js', '/manifest.webmanifest', '/styles.css', '/offline'];
app.use(async (req, res, next) => {
  if (req.user?.totp_enabled) return next();
  if (req.user && !req.user.totp_enabled) {
    // account exists but 2FA not finished — force enrollment
    if (req.path.startsWith('/totp') || req.path === '/logout' || OPEN_PATHS.includes(req.path)) return next();
    return res.redirect('/totp/setup');
  }
  if (OPEN_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  const n = await userCount();
  return res.redirect(n < 2 ? '/setup' : '/login');
});

function requireReauth(req, res) {
  if (recentlyAuthed(req.user)) return true;
  res.redirect('/reauth?next=' + encodeURIComponent(req.originalUrl));
  return false;
}

// pending rule changes: apply any whose time has come (apply-on-read)
async function applyDueRuleChanges() {
  const due = await q(`SELECT rc.*, r.code FROM rule_changes rc JOIN rules r ON r.id = rc.rule_id
    WHERE rc.applied_at IS NULL AND rc.effective_at <= now()`);
  for (const c of due.rows) {
    await q('UPDATE rules SET value_text = $1 WHERE id = $2', [c.new_value, c.rule_id]);
    await q('UPDATE rule_changes SET applied_at = now() WHERE id = $1', [c.id]);
    await audit(c.proposed_by, 'rule.applied', 'rule', c.code, { to: c.new_value });
  }
}

// ================= setup & auth =================
app.get('/setup', async (req, res) => {
  const n = await userCount();
  if (n >= 2) return res.redirect('/login');
  res.render('setup', { n, error: null });
});
app.post('/setup', async (req, res) => {
  const n = await userCount();
  if (n >= 2) return res.redirect('/login');
  const { name, email, password, password2 } = req.body;
  if (!name || !email || (password || '').length < 10)
    return res.render('setup', { n, error: 'Name, email, and a password of 10+ characters required.' });
  if (password !== password2)
    return res.render('setup', { n, error: 'Passwords do not match.' });
  try {
    const user = await createUser(email, name, password);
    await audit(user.id, 'user.created', 'user', user.id, { email: user.email });
    const sid = await createSession(user.id);
    setCookie(res, COOKIE, sid, 90 * 86400);
    res.redirect('/totp/setup');
  } catch (e) {
    res.render('setup', { n, error: e.code === '23505' ? 'That email is already registered.' : 'Could not create account.' });
  }
});

app.get('/login', (req, res) => {
  if (req.user?.totp_enabled) return res.redirect('/');
  res.render('login', { error: null });
});
const pendingTotp = new Map(); // token -> {userId, until}
app.post('/login', async (req, res) => {
  const r = await login(req.body.email, req.body.password);
  if (r.error) return res.render('login', { error: r.error });
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pendingTotp.set(token, { userId: r.user.id, until: Date.now() + 5 * 60000 });
  res.render('totp_verify', { token, error: null });
});
app.post('/totp/verify', async (req, res) => {
  const p = pendingTotp.get(req.body.token);
  if (!p || p.until < Date.now()) return res.render('login', { error: 'Login expired — try again.' });
  const { rows } = await q('SELECT * FROM users WHERE id = $1', [p.userId]);
  const user = rows[0];
  const code = String(req.body.code || '').trim();
  const ok = totpCheck(user.totp_secret, code) || (code.length >= 10 && await useRecoveryCode(user.id, code));
  if (!ok) return res.render('totp_verify', { token: req.body.token, error: 'Wrong code.' });
  pendingTotp.delete(req.body.token);
  noteSuccess(user.email);
  const sid = await createSession(user.id);
  setCookie(res, COOKIE, sid, 90 * 86400);
  await audit(user.id, 'login.success', 'user', user.id);
  res.redirect('/');
});

app.get('/totp/setup', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const { secret, uri } = totpSetup(req.user.email);
  await q('UPDATE users SET totp_secret = $1 WHERE id = $2 AND NOT totp_enabled', [secret, req.user.id]);
  const QR = (await import('qrcode')).default;
  const qr = await QR.toDataURL(uri);
  res.render('totp_setup', { qr, secret, error: null });
});
app.post('/totp/setup', async (req, res) => {
  const { rows } = await q('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!totpCheck(rows[0].totp_secret, req.body.code)) {
    const QR = (await import('qrcode')).default;
    const uri = (await import('otplib')).authenticator.keyuri(req.user.email, 'FamilyOS', rows[0].totp_secret);
    return res.render('totp_setup', { qr: await QR.toDataURL(uri), secret: rows[0].totp_secret, error: 'Code did not match — scan and try again.' });
  }
  await q('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [req.user.id]);
  const codes = await issueRecoveryCodes(req.user.id);
  await audit(req.user.id, 'totp.enabled', 'user', req.user.id);
  res.render('recovery_codes', { codes, first: true });
});

app.get('/reauth', (req, res) => res.render('reauth', { next: req.query.next || '/', error: null }));
app.post('/reauth', async (req, res) => {
  const ok = await verifyPassword(req.user.pw_hash, String(req.body.password || ''));
  if (!ok) return res.render('reauth', { next: req.body.next || '/', error: 'Wrong password.' });
  await markReauth(req.user.session_id);
  await audit(req.user.id, 'reauth', 'user', req.user.id);
  res.redirect(req.body.next || '/');
});

app.post('/logout', async (req, res) => {
  await destroySession(req.user.session_id);
  setCookie(res, COOKIE, '', 0);
  res.redirect('/login');
});

// ================= Today =================
app.get('/', async (req, res) => {
  await applyDueRuleChanges();
  const nw = await q(`SELECT
      coalesce(sum(valuation) FILTER (WHERE valuation >= 0),0) assets,
      coalesce(sum(valuation) FILTER (WHERE valuation < 0),0) debts,
      coalesce(sum(valuation),0) net
    FROM accounts WHERE NOT archived`);
  const buckets = await q(`SELECT bucket, coalesce(sum(-amount),0) spent FROM transactions
    WHERE amount < 0 AND status = 'ok' AND occurred_on >= date_trunc('month', CURRENT_DATE)
    GROUP BY bucket`);
  const unassigned = await q(`SELECT count(*) c, coalesce(sum(amount),0) s FROM income_events WHERE assigned_at IS NULL`);
  const stale = await q(`SELECT count(*) c FROM accounts WHERE NOT archived AND is_manual AND valued_at < CURRENT_DATE - 90`);
  const pending = await q(`SELECT rc.*, r.code, r.title FROM rule_changes rc
    JOIN rules r ON r.id = rc.rule_id WHERE rc.applied_at IS NULL ORDER BY rc.effective_at`);
  const dupes = await q(`SELECT count(*) c FROM transactions WHERE status = 'suspect_dupe'`);
  const kpis = await computeKpis();
  const sunday = new Date(); sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekOf = sunday.toISOString().slice(0, 10);
  const checkin = (await q(`SELECT * FROM checkins WHERE week_of = $1 AND kind='weekly'`, [weekOf])).rows[0];
  const monthStart = new Date(); monthStart.setDate(1);
  const monthOf = monthStart.toISOString().slice(0, 10);
  const close = (await q(`SELECT * FROM checkins WHERE week_of = $1 AND kind='monthly'`, [monthOf])).rows[0];
  res.render('today', {
    nw: nw.rows[0], buckets: buckets.rows, unassigned: unassigned.rows[0],
    stale: Number(stale.rows[0].c), pending: pending.rows, dupes: Number(dupes.rows[0].c),
    kpis, weakest: weakestKpi(kpis), checkin, close, weekOf, monthOf,
  });
});

app.post('/checkin', async (req, res) => {
  const { week_of, kind } = req.body;
  const col = 'completed_by_' + (req.body.slot === '2' ? '2' : '1');
  await q(`INSERT INTO checkins (week_of, kind, ${col}, notes) VALUES ($1,$2,$3,$4)
    ON CONFLICT (week_of) DO UPDATE SET ${col} = $3,
      notes = CASE WHEN EXCLUDED.notes <> '' THEN checkins.notes || E'\n' || EXCLUDED.notes ELSE checkins.notes END`,
    [week_of, kind === 'monthly' ? 'monthly' : 'weekly', req.user.id, req.body.notes || '']);
  await audit(req.user.id, 'checkin', 'checkin', week_of, { kind });
  res.redirect('/');
});

// ================= Goals & income =================
app.get('/goals', async (req, res) => {
  const goals = await q(`SELECT m.*, p.name person FROM missions m
    LEFT JOIN people p ON p.id = m.person_id WHERE m.closed_at IS NULL ORDER BY m.sort_order`);
  const steps = await q(`SELECT ws.*, m.name goal_name FROM waterfall_steps ws
    JOIN missions m ON m.id = ws.mission_id ORDER BY ws.sort_order`);
  const people = await q('SELECT * FROM people ORDER BY id');
  const sources = await q('SELECT * FROM income_sources ORDER BY id');
  const inbox = await q(`SELECT ie.*, s.name source FROM income_events ie
    LEFT JOIN income_sources s ON s.id = ie.source_id
    WHERE ie.assigned_at IS NULL ORDER BY ie.received_on DESC`);
  res.render('goals', { goals: goals.rows, steps: steps.rows, people: people.rows, sources: sources.rows, inbox: inbox.rows });
});

app.post('/goals', async (req, res) => {
  const { name, bucket, person_id, target, target_date } = req.body;
  if (!name) return res.redirect('/goals');
  const t = parseMoney(target);
  await q(`INSERT INTO missions (name, bucket, person_id, target_amount, target_date, sort_order)
    VALUES ($1,$2,$3,$4,$5, (SELECT coalesce(max(sort_order),0)+10 FROM missions))`,
    [name, bucket || 'save', person_id || null, t, target_date || null]);
  await audit(req.user.id, 'goal.created', 'mission', name);
  res.redirect('/goals');
});

app.post('/goals/:id', async (req, res) => {
  const t = parseMoney(req.body.target);
  await q(`UPDATE missions SET name = coalesce(nullif($1,''), name),
      target_amount = $2, target_date = nullif($3,'')::date WHERE id = $4`,
    [req.body.name || '', t, req.body.target_date || '', req.params.id]);
  await audit(req.user.id, 'goal.updated', 'mission', req.params.id);
  res.redirect('/goals');
});

app.post('/goals/:id/deposit', async (req, res) => {
  const amt = parseMoney(req.body.amount);
  if (amt) {
    await q('INSERT INTO mission_deposits (mission_id, amount) VALUES ($1,$2)', [req.params.id, amt]);
    await q('UPDATE missions SET balance = balance + $1 WHERE id = $2', [amt, req.params.id]);
    await audit(req.user.id, 'goal.deposit', 'mission', req.params.id, { amount: amt });
  }
  res.redirect('/goals');
});

app.post('/waterfall/:id', async (req, res) => {
  const bp = Math.max(0, Math.round(parseFloat(req.body.pct || '0') * 100));
  await q('UPDATE waterfall_steps SET amount_or_pct = $1 WHERE id = $2', [bp, req.params.id]);
  await audit(req.user.id, 'waterfall.updated', 'step', req.params.id, { bp });
  res.redirect('/goals');
});

app.post('/income', async (req, res) => {
  const amt = parseMoney(req.body.amount);
  if (!amt || amt <= 0) return res.redirect('/goals');
  const r = await q(`INSERT INTO income_events (source_id, amount, received_on, logged_by)
    VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.body.source_id || null, amt, req.body.received_on || new Date().toISOString().slice(0, 10), req.user.id]);
  await audit(req.user.id, 'income.logged', 'income', r.rows[0].id, { amount: amt });
  res.redirect('/income/' + r.rows[0].id + '/allocate');
});

async function allocationPreview(eventId) {
  const ev = (await q(`SELECT ie.*, s.name source, s.waterfall_profile_id FROM income_events ie
    LEFT JOIN income_sources s ON s.id = ie.source_id WHERE ie.id = $1`, [eventId])).rows[0];
  if (!ev) return null;
  const profileId = ev.waterfall_profile_id ||
    (await q('SELECT id FROM waterfall_profiles ORDER BY id LIMIT 1')).rows[0]?.id;
  const steps = (await q(`SELECT ws.*, m.name goal_name, m.balance, m.target_amount
    FROM waterfall_steps ws JOIN missions m ON m.id = ws.mission_id
    WHERE ws.profile_id = $1 AND m.closed_at IS NULL ORDER BY ws.sort_order`, [profileId])).rows;
  const plan = allocate(Number(ev.amount), steps);
  return { ev, steps, plan };
}

app.get('/income/:id/allocate', async (req, res) => {
  const data = await allocationPreview(req.params.id);
  if (!data) return res.redirect('/goals');
  if (data.ev.assigned_at) return res.redirect('/goals');
  res.render('allocate', data);
});

app.post('/income/:id/allocate', async (req, res) => {
  const ev = (await q('SELECT * FROM income_events WHERE id = $1 AND assigned_at IS NULL', [req.params.id])).rows[0];
  if (!ev) return res.redirect('/goals');
  let total = 0;
  const rows = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (!k.startsWith('alloc_')) continue;
    const amt = parseMoney(v);
    if (amt && amt > 0) { rows.push([Number(k.slice(6)), amt]); total += amt; }
  }
  if (total !== Number(ev.amount))
    return res.status(400).send(`Allocation (${fmtMoney(total)}) must equal the income (${fmtMoney(ev.amount)}). Go back and adjust.`);
  for (const [missionId, amt] of rows) {
    await q('INSERT INTO mission_deposits (mission_id, amount, income_event_id) VALUES ($1,$2,$3)',
            [missionId, amt, ev.id]);
    await q('UPDATE missions SET balance = balance + $1 WHERE id = $2', [amt, missionId]);
  }
  await q('UPDATE income_events SET assigned_at = now() WHERE id = $1', [ev.id]);
  await audit(req.user.id, 'income.assigned', 'income', ev.id, { total });
  res.redirect('/goals');
});

// ================= Accounts, CSV import, transactions =================
app.get('/accounts', async (req, res) => {
  const accounts = await q(`SELECT a.*, (a.is_manual AND a.valued_at < CURRENT_DATE - 90) stale
    FROM accounts a WHERE NOT archived ORDER BY a.valuation DESC`);
  const snaps = await q(`SELECT as_of, sum(value) net FROM account_snapshots GROUP BY as_of ORDER BY as_of DESC LIMIT 12`);
  const banks = plaidEnabled() ? await itemsOverview() : [];
  res.render('accounts', { accounts: accounts.rows, snaps: snaps.rows,
    plaid: plaidEnabled(), banks, plaidEnv: process.env.PLAID_ENV || 'sandbox' });
});

// ---- Plaid (activates when PLAID_CLIENT_ID/PLAID_SECRET are set) ----
app.get('/plaid/link-token', async (req, res) => {
  if (!plaidEnabled()) return res.status(400).json({ error: 'plaid not configured' });
  try { res.json({ link_token: await createLinkToken(req.user.id) }); }
  catch (e) { res.status(500).json({ error: e?.response?.data?.error_message || 'link token failed' }); }
});
app.post('/plaid/exchange', express.json(), async (req, res) => {
  if (!plaidEnabled()) return res.status(400).json({ error: 'plaid not configured' });
  try {
    await exchangePublicToken(req.body.public_token, req.body.institution || '', req.user.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e?.response?.data?.error_message || 'exchange failed' }); }
});
app.post('/plaid/sync', async (req, res) => {
  if (plaidEnabled()) await syncAll(req.user.id).catch(() => {});
  res.redirect('/accounts');
});
app.post('/plaid/revoke', async (req, res) => {
  if (!requireReauth(req, res)) return;
  const n = plaidEnabled() ? await revokeAll(req.user.id) : 0;
  res.redirect('/settings?revoked=' + n);
});

app.post('/accounts', async (req, res) => {
  const v = parseMoney(req.body.valuation) ?? 0;
  const val = req.body.is_debt ? -Math.abs(v) : v;
  const r = await q(`INSERT INTO accounts (name, type, valuation, liquidity_flag)
    VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.body.name, req.body.type || 'checking', val, req.body.illiquid ? false : true]);
  await q(`INSERT INTO account_snapshots (account_id, value, as_of) VALUES ($1,$2,CURRENT_DATE)
           ON CONFLICT (account_id, as_of) DO UPDATE SET value = $2`, [r.rows[0].id, val]);
  await audit(req.user.id, 'account.created', 'account', r.rows[0].id, { name: req.body.name });
  res.redirect('/accounts');
});

app.post('/accounts/:id', async (req, res) => {
  if (req.body.archive) {
    await q('UPDATE accounts SET archived = TRUE WHERE id = $1', [req.params.id]);
    await audit(req.user.id, 'account.archived', 'account', req.params.id);
    return res.redirect('/accounts');
  }
  const v = parseMoney(req.body.valuation);
  if (v != null) {
    const val = req.body.is_debt ? -Math.abs(v) : v;
    await q('UPDATE accounts SET valuation = $1, valued_at = CURRENT_DATE WHERE id = $2', [val, req.params.id]);
    await q(`INSERT INTO account_snapshots (account_id, value, as_of) VALUES ($1,$2,CURRENT_DATE)
             ON CONFLICT (account_id, as_of) DO UPDATE SET value = $2`, [req.params.id, val]);
    await audit(req.user.id, 'account.revalued', 'account', req.params.id, { value: val });
  }
  res.redirect('/accounts');
});

app.get('/accounts/:id/import', async (req, res) => {
  const account = (await q('SELECT * FROM accounts WHERE id = $1', [req.params.id])).rows[0];
  if (!account) return res.redirect('/accounts');
  res.render('import', { account, result: null });
});

app.post('/accounts/:id/import', async (req, res) => {
  const account = (await q('SELECT * FROM accounts WHERE id = $1', [req.params.id])).rows[0];
  if (!account) return res.redirect('/accounts');
  const rows = parseCsv(String(req.body.csv || ''));
  if (!rows.length) return res.render('import', { account, result: { error: 'No rows found.' } });
  const dateCol = Number(req.body.date_col ?? 0), descCol = Number(req.body.desc_col ?? 1), amtCol = Number(req.body.amount_col ?? 2);
  const skipHeader = !!req.body.skip_header;
  const batch = await q('INSERT INTO import_batches (account_id, filename, imported_by) VALUES ($1,$2,$3) RETURNING id',
    [account.id, req.body.filename || 'pasted.csv', req.user.id]);
  let imported = 0, suspects = 0, skipped = 0;
  for (let i = skipHeader ? 1 : 0; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = (r[dateCol] || '').trim();
    const d = new Date(rawDate);
    const amt = parseMoney(r[amtCol]);
    if (isNaN(d.getTime()) || amt == null) { skipped++; continue; }
    const iso = d.toISOString().slice(0, 10);
    const merchant = (r[descCol] || '').trim().slice(0, 200);
    const [h1, h2] = dedupeHashes(account.id, amt, iso, merchant);
    const dupe = await q(
      `SELECT 1 FROM transactions WHERE account_id = $1 AND dedupe_hash IN ($2,$3) AND status <> 'dismissed' LIMIT 1`,
      [account.id, h1, h2]);
    const status = dupe.rows.length ? 'suspect_dupe' : 'ok';
    if (status === 'suspect_dupe') suspects++; else imported++;
    await q(`INSERT INTO transactions (account_id, amount, occurred_on, merchant, import_batch_id, dedupe_hash, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`, [account.id, amt, iso, merchant, batch.rows[0].id, h1, status]);
  }
  await q('UPDATE import_batches SET row_count = $1 WHERE id = $2', [imported + suspects, batch.rows[0].id]);
  await audit(req.user.id, 'import', 'account', account.id, { imported, suspects, skipped });
  res.render('import', { account, result: { imported, suspects, skipped } });
});

app.get('/transactions', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const txns = await q(`SELECT t.*, a.name account FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE to_char(t.occurred_on, 'YYYY-MM') = $1 AND t.status <> 'dismissed'
    ORDER BY t.occurred_on DESC, t.id DESC LIMIT 500`, [month]);
  const suspects = await q(`SELECT t.*, a.name account FROM transactions t
    JOIN accounts a ON a.id = t.account_id WHERE t.status = 'suspect_dupe'
    ORDER BY t.occurred_on DESC LIMIT 100`);
  res.render('transactions', { txns: txns.rows, suspects: suspects.rows, month });
});

app.post('/transactions/:id/bucket', async (req, res) => {
  await q('UPDATE transactions SET bucket = nullif($1,\'\') WHERE id = $2', [req.body.bucket || '', req.params.id]);
  res.redirect(req.get('referer') || '/transactions');
});

app.post('/transactions/:id/resolve', async (req, res) => {
  const keep = req.body.action === 'keep';
  await q('UPDATE transactions SET status = $1 WHERE id = $2', [keep ? 'ok' : 'dismissed', req.params.id]);
  await audit(req.user.id, keep ? 'txn.kept' : 'txn.dismissed', 'transaction', req.params.id);
  res.redirect(req.get('referer') || '/transactions');
});

// ================= Decision Engine =================
const LENSES = [
  ['rulebook', '1. Rulebook — does it violate a rule?'],
  ['constitution', '2. Constitution — is this who we are?'],
  ['cashflow', '3. Cash flow — can we comfortably afford it?'],
  ['opportunity', '4. Opportunity cost — which Goal loses funding?'],
  ['recommendation', '5. Recommendation — what do we advise ourselves? (the AI joins in Phase 3)'],
];

app.get('/decisions', async (req, res) => {
  const decisions = await q(`SELECT d.*, u.name asked_by_name FROM decisions d
    JOIN users u ON u.id = d.asked_by ORDER BY d.created_at DESC`);
  res.render('decisions', { decisions: decisions.rows });
});

app.post('/decisions', async (req, res) => {
  const amt = parseMoney(req.body.amount);
  const r = await q('INSERT INTO decisions (title, amount, asked_by) VALUES ($1,$2,$3) RETURNING id',
    [req.body.title || 'Untitled decision', amt, req.user.id]);
  await audit(req.user.id, 'decision.created', 'decision', r.rows[0].id, { title: req.body.title });
  res.redirect('/decisions/' + r.rows[0].id);
});

app.get('/decisions/:id', async (req, res) => {
  const d = (await q(`SELECT d.*, u.name asked_by_name FROM decisions d
    JOIN users u ON u.id = d.asked_by WHERE d.id = $1`, [req.params.id])).rows[0];
  if (!d) return res.redirect('/decisions');
  const lensRows = await q('SELECT * FROM decision_lenses WHERE decision_id = $1', [req.params.id]);
  const lensMap = Object.fromEntries(lensRows.rows.map(l => [l.lens, l.content]));
  const rules = await q('SELECT * FROM rules ORDER BY id');
  const constitution = await q('SELECT * FROM constitution ORDER BY sort_order');
  res.render('decision', { d, LENSES, lensMap, rules: rules.rows, constitution: constitution.rows });
});

app.post('/decisions/:id/lens', async (req, res) => {
  const lens = String(req.body.lens || '');
  if (!LENSES.some(([k]) => k === lens)) return res.redirect('/decisions/' + req.params.id);
  await q(`INSERT INTO decision_lenses (decision_id, lens, content) VALUES ($1,$2,$3)
    ON CONFLICT (decision_id, lens) DO UPDATE SET content = $3`,
    [req.params.id, lens, req.body.content || '']);
  res.redirect('/decisions/' + req.params.id);
});

app.post('/decisions/:id/decide', async (req, res) => {
  await q(`UPDATE decisions SET status = 'decided', decided_at = now(), outcome = $1, outcome_notes = $2
    WHERE id = $3`, [req.body.outcome || 'wait', req.body.outcome_notes || '', req.params.id]);
  await audit(req.user.id, 'decision.decided', 'decision', req.params.id, { outcome: req.body.outcome });
  res.redirect('/decisions/' + req.params.id);
});

// ================= Rulebook & Constitution =================
app.get('/rules', async (req, res) => {
  await applyDueRuleChanges();
  const rules = await q('SELECT * FROM rules ORDER BY id');
  const changes = await q(`SELECT rc.*, r.code, u.name proposed_by_name FROM rule_changes rc
    JOIN rules r ON r.id = rc.rule_id JOIN users u ON u.id = rc.proposed_by
    ORDER BY rc.proposed_at DESC LIMIT 30`);
  res.render('rules', { rules: rules.rows, changes: changes.rows });
});

app.post('/rules/:id/change', async (req, res) => {
  if (!requireReauth(req, res)) return;
  const rule = (await q('SELECT * FROM rules WHERE id = $1', [req.params.id])).rows[0];
  if (!rule || !req.body.new_value) return res.redirect('/rules');
  const direction = req.body.direction === 'loosen' ? 'loosen' : 'tighten';
  const effective = ruleChangeEffectiveAt(direction);
  await q(`INSERT INTO rule_changes (rule_id, old_value, new_value, proposed_by, direction, effective_at)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [rule.id, rule.value_text, req.body.new_value, req.user.id, direction, effective]);
  if (direction === 'tighten') {
    await q('UPDATE rules SET value_text = $1 WHERE id = $2', [req.body.new_value, rule.id]);
    await q(`UPDATE rule_changes SET applied_at = now()
      WHERE rule_id = $1 AND applied_at IS NULL AND direction = 'tighten'`, [rule.id]);
  }
  await audit(req.user.id, 'rule.change.' + direction, 'rule', rule.code,
    { from: rule.value_text, to: req.body.new_value, effective });
  res.redirect('/rules');
});

app.get('/constitution', async (req, res) => {
  const qs = await q('SELECT * FROM constitution ORDER BY sort_order');
  const sigs = await q(`SELECT cs.*, u.name FROM constitution_signatures cs
    JOIN users u ON u.id = cs.user_id ORDER BY signed_at DESC`);
  res.render('constitution', { qs: qs.rows, sigs: sigs.rows });
});

app.post('/constitution/sign', async (req, res) => {
  await q('INSERT INTO constitution_signatures (user_id, note) VALUES ($1,$2)',
    [req.user.id, req.body.note || '']);
  await audit(req.user.id, 'constitution.signed', 'constitution', null);
  res.redirect('/constitution');
});

app.post('/constitution/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.redirect('/constitution');
  await q('UPDATE constitution SET answer = $1, updated_at = now() WHERE id = $2',
    [req.body.answer || '', req.params.id]);
  await audit(req.user.id, 'constitution.updated', 'constitution', req.params.id);
  res.redirect('/constitution');
});

// ================= Family & Library =================
app.get('/family', async (req, res) => {
  const people = await q(`SELECT p.*,
      (SELECT coalesce(sum(balance),0) FROM missions m WHERE m.person_id = p.id AND m.closed_at IS NULL) funded,
      (SELECT count(*) FROM missions m WHERE m.person_id = p.id AND m.closed_at IS NULL) goal_count
    FROM people p ORDER BY p.id`);
  const owners = await q('SELECT id, name, email FROM users ORDER BY id');
  res.render('family', { people: people.rows, owners: owners.rows });
});

app.post('/family', async (req, res) => {
  if (!req.body.name) return res.redirect('/family');
  await q('INSERT INTO people (name, kind, born_on) VALUES ($1,$2,nullif($3,\'\')::date)',
    [req.body.name, req.body.kind || 'child', req.body.born_on || '']);
  await audit(req.user.id, 'person.created', 'person', req.body.name);
  res.redirect('/family');
});

app.post('/family/:id', async (req, res) => {
  await q('UPDATE people SET born_on = nullif($1,\'\')::date WHERE id = $2',
    [req.body.born_on || '', req.params.id]);
  res.redirect('/family');
});

app.get('/library', async (req, res) => {
  const books = await q('SELECT * FROM books ORDER BY sort_order');
  res.render('library', { books: books.rows });
});

app.post('/library/:id', async (req, res) => {
  if (req.body.toggle) {
    await q(`UPDATE books SET done_at = CASE WHEN done_at IS NULL THEN CURRENT_DATE ELSE NULL END WHERE id = $1`,
      [req.params.id]);
  }
  if (req.body.notes != null) await q('UPDATE books SET notes = $1 WHERE id = $2', [req.body.notes, req.params.id]);
  res.redirect('/library');
});

// ================= Settings, audit, export, digest =================
app.get('/settings', async (req, res) => {
  const kpis = await computeKpis();
  res.render('settings', { kpis, smtp: !!process.env.SMTP_URL, plaid: plaidEnabled(),
    revoked: req.query.revoked });
});

app.post('/settings/recovery', async (req, res) => {
  if (!requireReauth(req, res)) return;
  const codes = await issueRecoveryCodes(req.user.id);
  await audit(req.user.id, 'recovery.reissued', 'user', req.user.id);
  res.render('recovery_codes', { codes, first: false });
});

app.get('/audit', async (req, res) => {
  const rows = await q(`SELECT a.*, u.name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 300`);
  res.render('audit', { rows: rows.rows });
});

app.get('/export.json', async (req, res) => {
  if (!requireReauth(req, res)) return;
  const out = {};
  for (const t of ['people', 'accounts', 'account_snapshots', 'missions', 'mission_deposits',
                   'income_sources', 'income_events', 'waterfall_profiles', 'waterfall_steps',
                   'transactions', 'rules', 'rule_changes', 'constitution', 'decisions',
                   'decision_lenses', 'checkins', 'books'])
    out[t] = (await q(`SELECT * FROM ${t}`)).rows;
  await audit(req.user.id, 'export.json', null, null);
  res.setHeader('Content-Disposition', 'attachment; filename=familyos-export.json');
  res.json(out);
});

app.get('/export.csv', async (req, res) => {
  if (!requireReauth(req, res)) return;
  const rows = (await q(`SELECT t.occurred_on, a.name account, t.merchant, t.amount, t.bucket, t.status
    FROM transactions t JOIN accounts a ON a.id = t.account_id ORDER BY t.occurred_on`)).rows;
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['date,account,merchant,amount,bucket,status',
    ...rows.map(r => [r.occurred_on.toISOString().slice(0, 10), r.account, r.merchant,
                      (r.amount / 100).toFixed(2), r.bucket || '', r.status].map(esc).join(','))].join('\n');
  await audit(req.user.id, 'export.csv', null, null);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
  res.send(csv);
});

app.get('/digest/preview', async (req, res) => {
  const { html } = await buildDigest();
  res.send(html);
});
app.post('/digest/send', async (req, res) => {
  const r = await sendDigest();
  await audit(req.user.id, 'digest.send', null, null, r);
  res.redirect('/settings');
});

// ================= PWA =================
app.get('/manifest.webmanifest', (req, res) => res.json({
  name: 'FamilyOS', short_name: 'FamilyOS', start_url: '/', display: 'standalone',
  background_color: '#f5f2ec', theme_color: '#b07d1e',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
}));
app.get('/offline', (req, res) => res.render('offline'));

// ================= boot =================
process.on('unhandledRejection', e => console.error('unhandledRejection', e));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Something broke — check the server log.'); });

const PORT = process.env.PORT || 3000;
migrate().then(seed).then(() => {
  app.listen(PORT, () => console.log(`FamilyOS listening on :${PORT}`));
}).catch(e => { console.error('boot failed', e); process.exit(1); });

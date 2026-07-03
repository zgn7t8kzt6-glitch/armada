// Owner's inbox triage — "manage my whole life from the app."
//
// Connects to the owner's Microsoft 365 mailbox with the OAuth DEVICE-CODE flow
// (he types a short code at microsoft.com/devicelogin once; no password ever
// touches this app). A poller then reads new mail on a schedule, an AI triage
// pass decides whether each message actually needs HIM, and only those land on
// the Desk mail board — Decision needed / Follow-up / Review. Everything else
// is counted and ignored. Tokens live in app_state (the DB), never in code or
// logs; we ask for Mail.Read only — this module cannot send or delete mail.

import { db, getState, setState } from './db.js';
import { triageEmail, claudeConfigured } from './claude.js';

db.exec(`CREATE TABLE IF NOT EXISTS desk_mail (
  id INTEGER PRIMARY KEY,
  msg_id TEXT UNIQUE,                  -- Graph message id (dedupe across polls)
  received_at TEXT,                    -- ISO from Graph
  from_name TEXT, from_email TEXT,
  subject TEXT, preview TEXT,          -- bodyPreview (first ~255 chars)
  web_link TEXT,                       -- opens the message in Outlook
  category TEXT,                       -- decision | followup | review | ignore
  reason TEXT,                         -- one-line why (from triage)
  action TEXT,                         -- suggested next action when it needs him
  status TEXT NOT NULL DEFAULT 'open', -- open | done | dismissed
  acted_at TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_desk_mail_cat ON desk_mail(category, status);
CREATE TABLE IF NOT EXISTS desk_mail_rules (
  id INTEGER PRIMARY KEY,
  from_email TEXT UNIQUE,              -- sender to auto-ignore
  why TEXT,                            -- 'muted' | 'auto: dismissed 3x'
  created TEXT NOT NULL DEFAULT (datetime('now'))
);`);

export function muteSender(fromEmail, why = 'muted') {
  const e = String(fromEmail || '').trim().toLowerCase();
  if (!e) return false;
  db.prepare(`INSERT OR IGNORE INTO desk_mail_rules (from_email, why) VALUES (?,?)`).run(e, why);
  return true;
}
export function unmuteSender(fromEmail) {
  db.prepare(`DELETE FROM desk_mail_rules WHERE from_email = ?`).run(String(fromEmail || '').trim().toLowerCase());
}
export function mutedSenders() { return db.prepare(`SELECT from_email, why, created FROM desk_mail_rules ORDER BY id DESC`).all(); }
// The learning loop: three dismissals of the same sender = he's told us enough.
export function noteDismissal(fromEmail) {
  const e = String(fromEmail || '').trim().toLowerCase();
  if (!e) return null;
  const n = db.prepare(`SELECT COUNT(*) c FROM desk_mail WHERE lower(from_email)=? AND status='dismissed'`).get(e).c;
  const kept = db.prepare(`SELECT COUNT(*) c FROM desk_mail WHERE lower(from_email)=? AND status='done'`).get(e).c;
  if (n >= 3 && kept === 0) { muteSender(e, 'auto: dismissed 3×'); return e; }
  return null;
}

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access User.Read Mail.Read';

export function mailConfigured() { return Boolean((getState('msgraph_client_id') || '').trim()); }
export function mailConnected() { return Boolean(getState('msgraph_refresh_token')); }
function tenant() { return (getState('msgraph_tenant') || '').trim() || 'organizations'; }

// ── Device-code sign-in ───────────────────────────────────────────────────────
// startDeviceFlow returns { user_code, verification_uri } for the UI and keeps
// polling the token endpoint in the background until he finishes signing in.
let _pending = null;   // { device_code, interval, expires_at, timer }
export async function startDeviceFlow() {
  const clientId = (getState('msgraph_client_id') || '').trim();
  if (!clientId) return { error: 'Save the Microsoft App (client) ID first.' };
  const r = await fetch(`${LOGIN}/${encodeURIComponent(tenant())}/oauth2/v2.0/devicecode`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
  });
  const d = await r.json();
  if (!r.ok || !d.device_code) return { error: d.error_description || d.error || 'Could not start Microsoft sign-in.' };
  if (_pending?.timer) clearInterval(_pending.timer);
  _pending = { device_code: d.device_code, interval: Math.max(5, +d.interval || 5), expires_at: Date.now() + (+d.expires_in || 900) * 1000 };
  _pending.timer = setInterval(async () => {
    try {
      if (!_pending || Date.now() > _pending.expires_at) { if (_pending?.timer) clearInterval(_pending.timer); _pending = null; return; }
      const t = await fetch(`${LOGIN}/${encodeURIComponent(tenant())}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: _pending.device_code }),
      });
      const tok = await t.json();
      if (tok.error === 'authorization_pending' || tok.error === 'slow_down') return;
      clearInterval(_pending.timer); _pending = null;
      if (!tok.refresh_token) { console.error('[mail] device flow:', tok.error_description || tok.error || 'no token'); return; }
      setState('msgraph_refresh_token', tok.refresh_token);
      _access = { token: tok.access_token, exp: Date.now() + Math.max(60, (+tok.expires_in || 3600) - 120) * 1000 };
      try { const me = await graphGet('/me'); setState('msgraph_user', me.mail || me.userPrincipalName || ''); } catch { /* cosmetic */ }
      console.log('[mail] mailbox connected:', getState('msgraph_user') || '(user unknown)');
    } catch (e) { console.error('[mail] device poll:', e.message); }
  }, (Math.max(5, +d.interval || 5)) * 1000);
  _pending.timer.unref?.();
  return { user_code: d.user_code, verification_uri: d.verification_uri || 'https://microsoft.com/devicelogin', expires_in: d.expires_in };
}
export function disconnectMailbox() {
  setState('msgraph_refresh_token', ''); setState('msgraph_user', '');
  _access = null;
  if (_pending?.timer) { clearInterval(_pending.timer); _pending = null; }
}

// ── Tokens ────────────────────────────────────────────────────────────────────
let _access = null;   // { token, exp }
async function accessToken() {
  if (_access && Date.now() < _access.exp) return _access.token;
  const refresh = getState('msgraph_refresh_token');
  const clientId = (getState('msgraph_client_id') || '').trim();
  if (!refresh || !clientId) throw new Error('Mailbox is not connected.');
  const r = await fetch(`${LOGIN}/${encodeURIComponent(tenant())}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh, scope: SCOPE }),
  });
  const tok = await r.json();
  if (!tok.access_token) {
    // A revoked/expired grant needs a fresh sign-in — surface that plainly.
    if (tok.error === 'invalid_grant') { disconnectMailbox(); throw new Error('Microsoft sign-in expired — reconnect the mailbox.'); }
    throw new Error(tok.error_description || tok.error || 'Could not refresh the Microsoft token.');
  }
  if (tok.refresh_token) setState('msgraph_refresh_token', tok.refresh_token);   // Microsoft rotates these
  _access = { token: tok.access_token, exp: Date.now() + Math.max(60, (+tok.expires_in || 3600) - 120) * 1000 };
  return _access.token;
}
async function graphGet(path) {
  const t = await accessToken();
  const r = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${t}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || `Graph ${r.status}`);
  return d;
}

// ── The poll: read new mail, triage, file ─────────────────────────────────────
let _polling = false;
export async function pollMailbox({ max = 25 } = {}) {
  if (!mailConnected()) return { error: 'Mailbox is not connected.' };
  if (!claudeConfigured()) return { error: 'AI is not configured — triage needs it.' };
  if (_polling) return { error: 'A mail check is already running.' };
  _polling = true;
  try {
    // First run looks back 24h; afterwards we resume from the newest seen mail.
    const since = getState('mail_last_poll') || new Date(Date.now() - 24 * 3600e3).toISOString();
    const q = `/me/messages?$top=50&$orderby=receivedDateTime asc&$filter=receivedDateTime gt ${encodeURIComponent(since)}` +
      `&$select=id,subject,from,receivedDateTime,bodyPreview,webLink`;
    const d = await graphGet(q);
    const msgs = Array.isArray(d.value) ? d.value : [];
    const has = db.prepare(`SELECT 1 FROM desk_mail WHERE msg_id = ?`);
    const ins = db.prepare(`INSERT OR IGNORE INTO desk_mail (msg_id, received_at, from_name, from_email, subject, preview, web_link, category, reason, action)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    let triaged = 0, surfaced = 0, ignored = 0, newest = since, lastErr = null;
    const runTriage = async (args) => {
      try { return await triageEmail(args); }
      catch (e1) {
        await new Promise((r2) => setTimeout(r2, 2500));   // one retry — transient API blips
        try { return await triageEmail(args); }
        catch (e2) { lastErr = String(e2.message || e2).slice(0, 200); throw e2; }
      }
    };
    // Second chances: anything that failed triage last time gets re-run first.
    const retryRows = db.prepare(`SELECT id, from_name, from_email, subject, preview FROM desk_mail WHERE status='open' AND reason LIKE 'Triage failed%' LIMIT 10`).all();
    for (const rr of retryRows) {
      try {
        const t2 = await runTriage({ from: `${rr.from_name} <${rr.from_email}>`, subject: rr.subject || '', preview: rr.preview || '', myEmail: getState('msgraph_user') || '' });
        const cat2 = t2.needs_me ? (['decision', 'followup', 'review'].includes(t2.category) ? t2.category : 'review') : 'ignore';
        db.prepare(`UPDATE desk_mail SET category=?, reason=?, action=? WHERE id=?`).run(cat2, String(t2.reason || '').slice(0, 300), String(t2.action || '').slice(0, 200), rr.id);
      } catch { /* stays surfaced; next poll retries again */ }
    }
    for (const m of msgs) {
      if (m.receivedDateTime && m.receivedDateTime > newest) newest = m.receivedDateTime;
      if (has.get(m.id)) continue;
      if (triaged >= max) break;   // stay gentle on the AI budget; next poll continues
      const fromName = m.from?.emailAddress?.name || '';
      const fromEmail = m.from?.emailAddress?.address || '';
      // Muted senders skip triage entirely — the owner (or three of his
      // dismissals) already made this call.
      const muted = fromEmail && db.prepare(`SELECT why FROM desk_mail_rules WHERE from_email = ?`).get(fromEmail.toLowerCase());
      let t;
      if (muted) t = { needs_me: false, category: 'ignore', reason: `Muted sender (${muted.why}).`, action: '' };
      else {
        try { t = await runTriage({ from: `${fromName} <${fromEmail}>`, subject: m.subject || '', preview: m.bodyPreview || '', myEmail: getState('msgraph_user') || '' }); }
        catch (e) { console.error('[mail] triage:', e.message); t = { needs_me: true, category: 'review', reason: ('Triage failed: ' + String(e.message || e).slice(0, 140)) + ' — surfaced so nothing is missed.', action: '' }; }
      }
      const cat = t.needs_me ? (['decision', 'followup', 'review'].includes(t.category) ? t.category : 'review') : 'ignore';
      ins.run(m.id, m.receivedDateTime || null, fromName, fromEmail, String(m.subject || '').slice(0, 300), String(m.bodyPreview || '').slice(0, 400), m.webLink || null, cat, String(t.reason || '').slice(0, 300), String(t.action || '').slice(0, 200));
      triaged++;
      if (cat === 'ignore') ignored++; else surfaced++;
    }
    // Only advance the cursor past what we actually triaged.
    if (triaged >= max && msgs.length > triaged) { /* keep cursor; next run resumes */ } else { setState('mail_last_poll', newest); }
    setState('mail_last_run', new Date().toISOString());
    if (lastErr) setState('mail_last_error', lastErr); else setState('mail_last_error', '');
    return { ok: true, checked: msgs.length, triaged, surfaced, ignored, retried: retryRows.length, lastError: lastErr };
  } catch (e) { return { error: e.message }; }
  finally { _polling = false; }
}

export function mailBoard() {
  const open = (cat) => db.prepare(`SELECT * FROM desk_mail WHERE category=? AND status='open' ORDER BY received_at DESC LIMIT 40`).all(cat);
  const today = new Date().toISOString().slice(0, 10);
  return {
    decision: open('decision'), followup: open('followup'), review: open('review'),
    ignoredToday: db.prepare(`SELECT COUNT(*) c FROM desk_mail WHERE category='ignore' AND substr(created,1,10)=?`).get(today).c,
    ignoredRecent: db.prepare(`SELECT from_name, from_email, subject, reason, received_at FROM desk_mail WHERE category='ignore' ORDER BY id DESC LIMIT 15`).all(),
    doneToday: db.prepare(`SELECT COUNT(*) c FROM desk_mail WHERE status!='open' AND substr(acted_at,1,10)=?`).get(today).c,
  };
}

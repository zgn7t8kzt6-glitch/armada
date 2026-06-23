// Authentication: bcrypt password hashing + DB-backed session tokens in an
// HttpOnly cookie. No third-party session library needed.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, audit, getState, setState } from './db.js';

const COOKIE = 'armada_sid';
const TD_COOKIE = 'armada_td';            // trusted-device cookie (skips MFA for a window)
const TD_DAYS = +(process.env.MFA_TRUST_DAYS || 30);
const SESSION_DAYS = 1;
const mfaTickets = new Map(); // ticket -> { uid, exp, enroll } (short-lived, between password and code)

// MFA is required for everyone unless explicitly turned off (state or env kill-switch).
export function mfaRequired() {
  if (process.env.MFA_REQUIRED === 'off') return false;
  return getState('mfa_required') !== 'off';
}
export function setMfaRequired(on) { setState('mfa_required', on ? 'on' : 'off'); }

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

// ---- TOTP (RFC 6238) — no external dependency ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) { const idx = B32.indexOf(ch); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function totpAt(secretB32, counter) {
  const key = b32decode(secretB32);
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1e6;
  return String(code).padStart(6, '0');
}
export function totpVerify(secretB32, code, window = 1) {
  if (!secretB32 || !/^\d{6}$/.test(String(code || '').trim())) return false;
  const c = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) if (totpAt(secretB32, c + i) === String(code).trim()) return true;
  return false;
}
export function mfaSetup(userId, username) {
  let u = db.prepare(`SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?`).get(userId);
  let secret = u?.mfa_secret;
  if (!secret || u.mfa_enabled) { secret = b32encode(crypto.randomBytes(20)); db.prepare(`UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?`).run(secret, userId); }
  return { secret, otpauth: `otpauth://totp/Armada%20Care:${encodeURIComponent(username)}?secret=${secret}&issuer=Armada%20Care&period=30&digits=6` };
}
export function mfaEnable(userId, code) {
  const u = db.prepare(`SELECT mfa_secret FROM users WHERE id = ?`).get(userId);
  if (!u?.mfa_secret || !totpVerify(u.mfa_secret, code)) return false;
  db.prepare(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`).run(userId);
  return true;
}
export function mfaDisable(userId) { db.prepare(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?`).run(userId); }

// ---- Trusted device: after MFA, this browser skips the code for TD_DAYS. The
// signature folds in a slice of the password hash, so changing the password (or
// disabling MFA) automatically invalidates every trusted device. ----
function tdSecret() { let s = getState('mfa_td_secret'); if (!s) { s = crypto.randomBytes(32).toString('hex'); setState('mfa_td_secret', s); } return s; }
function tdSign(uid, exp, pwHash) { return crypto.createHmac('sha256', tdSecret()).update(`${uid}.${exp}.${String(pwHash || '').slice(0, 24)}`).digest('hex'); }
function issueTrustedDevice(res, user) {
  const exp = Date.now() + TD_DAYS * 864e5;
  const val = `${user.id}.${exp}.${tdSign(user.id, exp, user.password_hash)}`;
  res.cookie(TD_COOKIE, val, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: new Date(exp) });
}
function deviceTrusted(req, user) {
  const c = req.cookies?.[TD_COOKIE]; if (!c) return false;
  const [uid, exp, sig] = c.split('.');
  if (+uid !== user.id || !exp || +exp < Date.now() || !sig) return false;
  try { const good = tdSign(user.id, +exp, user.password_hash); return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); }
  catch { return false; }
}

function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, user.id, expires.toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires });
  audit({ user, action: 'LOGIN', ip: req.ip });
  return safeUser(user);
}

export function createUser({ name, username, password, role = 'staff', job_role = 'BHT / Tech' }) {
  const info = db.prepare(
    `INSERT INTO users (name, username, password_hash, role, job_role) VALUES (?, ?, ?, ?, ?)`
  ).run(name, username.toLowerCase().trim(), hashPassword(password), role, job_role);
  return info.lastInsertRowid;
}

// ---- Approved email domains + invite-based signup ----
// New users must have an email on one of the approved company domains, and they
// set their own password from an emailed invite link — we never send credentials.
const DEFAULT_DOMAINS = ['armadarecovery.com', 'hilltoprecoveryhome.com', 'sparkrecovery.com', 'reveriesoberliving.com'];
export function allowedDomains() {
  try { const s = JSON.parse(getState('allowed_domains') || 'null'); if (Array.isArray(s) && s.length) return s.map(cleanDomain).filter(Boolean); } catch { /* fall through */ }
  return DEFAULT_DOMAINS;
}
function cleanDomain(d) { return String(d || '').toLowerCase().replace(/^@/, '').trim(); }
export function setAllowedDomains(list) {
  const arr = [...new Set((list || []).map(cleanDomain).filter(Boolean))];
  setState('allowed_domains', JSON.stringify(arr));
  return arr;
}
export function emailDomainAllowed(email) {
  const m = /@([^@\s]+)$/.exec(String(email || '').toLowerCase().trim());
  return !!m && allowedDomains().includes(m[1]);
}
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
const INVITE_DAYS = 7;
export function createInvite({ name, email, role = 'staff', job_role = 'BHT / Tech', invitedBy = '' }) {
  const em = String(email || '').toLowerCase().trim();
  const token = crypto.randomBytes(32).toString('hex');
  const placeholder = hashPassword(crypto.randomBytes(24).toString('hex')); // unusable until they accept
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  const info = db.prepare(
    `INSERT INTO users (name, username, email, password_hash, role, job_role, active, pending, invite_token, invite_expires, invited_at, invited_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, datetime('now'), ?)`
  ).run(name, em, em, placeholder, role, job_role, hashToken(token), expires, invitedBy);
  return { id: Number(info.lastInsertRowid), token };
}
export function regenInvite(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  db.prepare(`UPDATE users SET invite_token = ?, invite_expires = ?, invited_at = datetime('now'), pending = 1 WHERE id = ?`)
    .run(hashToken(token), expires, userId);
  return token;
}
export function inviteInfo(token) {
  if (!token) return null;
  const u = db.prepare(`SELECT name, email, invite_expires FROM users WHERE invite_token = ? AND active = 1`).get(hashToken(token));
  if (!u) return null;
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return { expired: true };
  return { name: u.name, email: u.email };
}
export function acceptInvite(token, password) {
  if (!token) return { error: 'Missing invite token.' };
  if (!password || String(password).length < 8) return { error: 'Password must be at least 8 characters.' };
  const u = db.prepare(`SELECT * FROM users WHERE invite_token = ? AND active = 1`).get(hashToken(token));
  if (!u) return { error: 'This invite link is invalid or has already been used.' };
  if (u.invite_expires && new Date(u.invite_expires) < new Date()) return { error: 'This invite has expired — ask your admin to resend it.' };
  db.prepare(`UPDATE users SET password_hash = ?, pending = 0, invite_token = NULL, invite_expires = NULL WHERE id = ?`)
    .run(hashPassword(String(password)), u.id);
  return { ok: true, email: u.email, name: u.name };
}

// Verify a second staff member's credentials inline (e.g. a witness co-signing a
// cash count) without starting a session — true non-repudiation, not a typed name.
export function verifyCredentials(username, password) {
  const u = db.prepare(`SELECT id, name, username, password_hash, active FROM users WHERE lower(username) = ? OR lower(email) = ?`).get(String(username || '').toLowerCase().trim(), String(username || '').toLowerCase().trim());
  if (!u || !u.active || !password) return null;
  return bcrypt.compareSync(String(password), u.password_hash) ? { id: u.id, name: u.name } : null;
}

export function verifyUserById(id, password) {
  const u = db.prepare(`SELECT id, name, password_hash, active FROM users WHERE id = ?`).get(id);
  if (!u || !u.active || !password) return null;
  return bcrypt.compareSync(String(password), u.password_hash) ? { id: u.id, name: u.name } : null;
}

export function login(req, res, username, password) {
  const user = db.prepare(`SELECT * FROM users WHERE username = ? AND active = 1`).get(username.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  if (user.mfa_enabled) {
    if (deviceTrusted(req, user)) return startSession(req, res, user);   // remembered device → no code
    const ticket = crypto.randomBytes(24).toString('hex');
    mfaTickets.set(ticket, { uid: user.id, exp: Date.now() + 5 * 60000, enroll: false });
    return { mfaRequired: true, ticket };
  }
  if (mfaRequired()) {
    // Not enrolled yet, but MFA is mandatory — walk them through setup right now.
    const { secret, otpauth } = mfaSetup(user.id, user.username);
    const ticket = crypto.randomBytes(24).toString('hex');
    mfaTickets.set(ticket, { uid: user.id, exp: Date.now() + 10 * 60000, enroll: true });
    return { mfaEnroll: true, ticket, secret, otpauth };
  }
  return startSession(req, res, user);
}
export function completeMfa(req, res, ticket, code, trustDevice = false) {
  const t = mfaTickets.get(ticket);
  if (!t || t.exp < Date.now()) { mfaTickets.delete(ticket); return null; }
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(t.uid);
  if (!user || !totpVerify(user.mfa_secret, code)) return null;
  if (t.enroll) { db.prepare(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`).run(user.id); audit({ user, action: 'MFA_ENABLE', ip: req.ip }); }
  mfaTickets.delete(ticket);
  if (trustDevice) issueTrustedDevice(res, user);
  return startSession(req, res, user);
}
// The otpauth URI behind an enrollment ticket — lets the pre-login QR render
// without a session (ticket-gated, short-lived, enrollment only).
export function otpauthForTicket(ticket) {
  const t = mfaTickets.get(ticket);
  if (!t || t.exp < Date.now() || !t.enroll) return null;
  const u = db.prepare(`SELECT username, mfa_secret FROM users WHERE id = ?`).get(t.uid);
  if (!u?.mfa_secret) return null;
  return `otpauth://totp/Armada%20Care:${encodeURIComponent(u.username)}?secret=${u.mfa_secret}&issuer=Armada%20Care&period=30&digits=6`;
}

export function logout(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  res.clearCookie(COOKIE);
}

export function currentUser(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
  ).get(token);
  return row ? safeUser(row) : null;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Staffing/scheduling is the Director of Operations' core lane — let her manage
// it without a full admin login (admins still allowed).
export function requireStaffingManager(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.job_role === 'Director of Operations') return next();
  return res.status(403).json({ error: 'Staffing is managed by the Director of Operations or an admin.' });
}

export function changePassword(userId, current, next, keepToken = null) {
  const u = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId);
  if (!u || !bcrypt.compareSync(current, u.password_hash)) return false;
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(next), userId);
  // Invalidate every OTHER session for this user (a changed password should log
  // out anyone holding an old/stolen token); keep the caller's current session.
  if (keepToken) db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token != ?`).run(userId, keepToken);
  else db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  return true;
}

function safeUser(u) {
  return { id: u.id, name: u.name, username: u.username, role: u.role, job_role: u.job_role, mfaEnabled: !!u.mfa_enabled };
}

// Minimal cookie parser middleware (avoids cookie-parser dependency)
export function cookies(req, res, next) {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  res.cookie = (name, val, opts = {}) => {
    let str = `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly`;
    if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
    if (opts.secure) str += '; Secure';
    if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
    res.append('Set-Cookie', str);
  };
  res.clearCookie = (name) => res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`);
  next();
}

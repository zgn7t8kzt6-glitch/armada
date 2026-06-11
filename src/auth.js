// Authentication: bcrypt password hashing + DB-backed session tokens in an
// HttpOnly cookie. No third-party session library needed.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, audit } from './db.js';

const COOKIE = 'armada_sid';
const SESSION_DAYS = 1;
const mfaTickets = new Map(); // ticket -> { uid, exp } (short-lived, between password and code)

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

export function login(req, res, username, password) {
  const user = db.prepare(`SELECT * FROM users WHERE username = ? AND active = 1`).get(username.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
  if (user.mfa_enabled) {
    const ticket = crypto.randomBytes(24).toString('hex');
    mfaTickets.set(ticket, { uid: user.id, exp: Date.now() + 5 * 60000 });
    return { mfaRequired: true, ticket };
  }
  return startSession(req, res, user);
}
export function completeMfa(req, res, ticket, code) {
  const t = mfaTickets.get(ticket);
  if (!t || t.exp < Date.now()) { mfaTickets.delete(ticket); return null; }
  const user = db.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(t.uid);
  if (!user || !totpVerify(user.mfa_secret, code)) return null;
  mfaTickets.delete(ticket);
  return startSession(req, res, user);
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

export function changePassword(userId, current, next) {
  const u = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId);
  if (!u || !bcrypt.compareSync(current, u.password_hash)) return false;
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(next), userId);
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

// Authentication: bcrypt password hashing + DB-backed session tokens in an
// HttpOnly cookie. No third-party session library needed.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, audit } from './db.js';

const COOKIE = 'armada_sid';
const SESSION_DAYS = 7;

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
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
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, user.id, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
  audit({ user, action: 'LOGIN', ip: req.ip });
  return safeUser(user);
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

function safeUser(u) {
  return { id: u.id, name: u.name, username: u.username, role: u.role, job_role: u.job_role };
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

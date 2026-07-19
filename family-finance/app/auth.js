import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { authenticator } from 'otplib';
import { q, audit } from './db.js';

const SESSION_DAYS = 30;
const ABSOLUTE_DAYS = 90;
const REAUTH_MINUTES = 15; // window for sensitive actions after a fresh login

export const hashPassword = pw => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash, pw) => argon2.verify(hash, pw).catch(() => false);
const sha = s => createHash('sha256').update(s).digest('hex');

export async function userCount() {
  return Number((await q('SELECT count(*) c FROM users')).rows[0].c);
}

export async function createUser(email, name, password) {
  const pw = await hashPassword(password);
  const { rows } = await q(
    'INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING *',
    [email.toLowerCase().trim(), name.trim(), pw]);
  return rows[0];
}

export async function createSession(userId) {
  const id = randomBytes(32).toString('base64url');
  await q(`INSERT INTO sessions (id, user_id, expires_at)
           VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`, [id, userId]);
  return id;
}

export async function destroySession(id) {
  await q('DELETE FROM sessions WHERE id = $1', [id]);
}

export async function sessionUser(id) {
  if (!id) return null;
  const { rows } = await q(
    `SELECT u.*, s.id session_id, s.reauth_at,
            s.created_at < now() - interval '${ABSOLUTE_DAYS} days' AS absolute_expired
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`, [id]);
  const r = rows[0];
  if (!r || r.absolute_expired) return null;
  // rolling refresh
  await q(`UPDATE sessions SET expires_at = now() + interval '${SESSION_DAYS} days' WHERE id = $1`, [id]);
  return r;
}

export const recentlyAuthed = user =>
  user && (Date.now() - new Date(user.reauth_at).getTime()) < REAUTH_MINUTES * 60000;

export async function markReauth(sessionId) {
  await q('UPDATE sessions SET reauth_at = now() WHERE id = $1', [sessionId]);
}

// ---- TOTP ----
export function totpSetup(email) {
  const secret = authenticator.generateSecret();
  const uri = authenticator.keyuri(email, 'FamilyOS', secret);
  return { secret, uri };
}
export const totpCheck = (secret, token) => {
  try { return authenticator.verify({ secret, token: String(token || '').replace(/\s/g, '') }); }
  catch { return false; }
};

// ---- recovery codes ----
export async function issueRecoveryCodes(userId) {
  await q('DELETE FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(5).toString('hex'); // 10 hex chars
    codes.push(code);
    await q('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1,$2)', [userId, sha(code)]);
  }
  return codes;
}

export async function useRecoveryCode(userId, code) {
  const { rows } = await q(
    `UPDATE recovery_codes SET used_at = now()
      WHERE id = (SELECT id FROM recovery_codes
                   WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL LIMIT 1)
      RETURNING id`, [userId, sha(String(code || '').trim().toLowerCase())]);
  return rows.length > 0;
}

// ---- login with rate limit ----
const attempts = new Map(); // email -> {count, until}
export function throttled(email) {
  const a = attempts.get(email);
  return a && a.count >= 8 && Date.now() < a.until;
}
export function noteFailure(email) {
  const a = attempts.get(email) || { count: 0, until: 0 };
  a.count++; a.until = Date.now() + 15 * 60000;
  attempts.set(email, a);
}
export function noteSuccess(email) { attempts.delete(email); }

export async function login(email, password) {
  email = String(email || '').toLowerCase().trim();
  if (throttled(email)) { await audit(null, 'login.throttled', 'user', email); return { error: 'Too many attempts. Try again in 15 minutes.' }; }
  const { rows } = await q('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = user && await verifyPassword(user.pw_hash, String(password || ''));
  if (!ok) { noteFailure(email); await audit(user?.id ?? null, 'login.failed', 'user', email); return { error: 'Wrong email or password.' }; }
  return { user };
}

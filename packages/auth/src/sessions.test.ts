import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from './sessions.js';

const SECRET = 'test-secret-that-is-long-enough-0123456789';

function manager(overrides: { ttlMinutes?: number; now?: () => Date } = {}) {
  return new SessionManager({
    secret: SECRET,
    ttlMinutes: overrides.ttlMinutes ?? 30,
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
  });
}

test('create + verify round-trips a session', () => {
  const sessions = manager();
  const { token, session } = sessions.create('user-1');
  const result = sessions.verify(token);
  assert.ok(result.ok);
  assert.equal(result.session.id, session.id);
  assert.equal(result.session.userId, 'user-1');
});

test('rejects malformed and tampered tokens', () => {
  const sessions = manager();
  const { token } = sessions.create('user-1');
  assert.equal(sessions.verify('garbage').ok, false);
  assert.equal(sessions.verify('a.b.c').ok, false);
  const [payload, sig] = token.split('.') as [string, string];
  const forgedPayload = Buffer.from(
    JSON.stringify({ sid: 'x', sub: 'attacker', exp: Date.now() + 9e9 }),
  ).toString('base64url');
  const forged = sessions.verify(`${forgedPayload}.${sig}`);
  assert.ok(!forged.ok && forged.reason === 'bad_signature');
  assert.ok(payload.length > 0);
});

test('tokens from a differently-keyed manager are rejected', () => {
  const a = manager();
  const b = new SessionManager({ secret: `${SECRET}-different`, ttlMinutes: 30 });
  const { token } = a.create('user-1');
  const result = b.verify(token);
  assert.ok(!result.ok && result.reason === 'bad_signature');
});

test('revocation is immediate (§24: revoked user token attempts access)', () => {
  const sessions = manager();
  const { token, session } = sessions.create('user-1');
  assert.equal(sessions.revoke(session.id), true);
  const result = sessions.verify(token);
  assert.ok(!result.ok && result.reason === 'revoked');
});

test('revokeAllForUser clears every session for that user only', () => {
  const sessions = manager();
  const one = sessions.create('user-1');
  const two = sessions.create('user-1');
  const other = sessions.create('user-2');
  assert.equal(sessions.revokeAllForUser('user-1'), 2);
  assert.equal(sessions.verify(one.token).ok, false);
  assert.equal(sessions.verify(two.token).ok, false);
  assert.equal(sessions.verify(other.token).ok, true);
});

test('sessions expire by clock', () => {
  let t = new Date('2026-07-21T12:00:00.000Z');
  const sessions = manager({ ttlMinutes: 5, now: () => t });
  const { token } = sessions.create('user-1');
  t = new Date('2026-07-21T12:04:59.000Z');
  assert.equal(sessions.verify(token).ok, true);
  t = new Date('2026-07-21T12:05:00.000Z');
  const result = sessions.verify(token);
  assert.ok(!result.ok && result.reason === 'expired');
});

test('refuses weak secrets and zero TTLs', () => {
  assert.throws(() => new SessionManager({ secret: 'short', ttlMinutes: 30 }));
  assert.throws(() => new SessionManager({ secret: SECRET, ttlMinutes: 0 }));
});

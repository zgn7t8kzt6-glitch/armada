import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS_HASH, InMemoryAuditLog, computeEventHash, type AuditEvent } from './index.js';

const fixedClock = () => new Date('2026-07-21T12:00:00.000Z');

function makeLog(): InMemoryAuditLog {
  let id = 0;
  return new InMemoryAuditLog({ now: fixedClock, newId: () => `evt-${++id}` });
}

test('appends events with sequence and hash chain', () => {
  const log = makeLog();
  const first = log.append({
    actorType: 'user',
    actorId: 'user-1',
    action: 'session.created',
    subjectType: 'session',
    subjectId: 'sess-1',
  });
  const second = log.append({
    actorType: 'user',
    actorId: 'user-1',
    action: 'patient_summary.read',
    subjectType: 'facility',
    subjectId: 'fac-akron',
    facilityId: 'fac-akron',
    policyDecision: 'ALLOW',
  });
  assert.equal(first.sequence, 1);
  assert.equal(first.previousHash, GENESIS_HASH);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousHash, first.hash);
  assert.deepEqual(log.verifyIntegrity(), { ok: true, events: 2 });
});

test('events are frozen and the log exposes no mutation surface', () => {
  const log = makeLog();
  const event = log.append({
    actorType: 'service',
    actorId: 'svc-worker',
    action: 'ingestion.completed',
    subjectType: 'ingestion_run',
    subjectId: 'run-1',
  });
  assert.ok(Object.isFrozen(event));
  assert.throws(() => {
    (event as { actorId: string }).actorId = 'tampered';
  });
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(log));
  assert.ok(!surface.some((m) => /delete|update|remove|clear|set/i.test(m)), surface.join(','));
});

test('query results are copies — writing to them cannot alter the log', () => {
  const log = makeLog();
  const target = log.append({
    actorType: 'user',
    actorId: 'user-1',
    action: 'a.one',
    subjectType: 's',
    subjectId: '1',
  });
  const results = log.query() as AuditEvent[];
  results[0] = { ...target, actorId: 'attacker' } as AuditEvent;
  assert.equal(log.query()[0]?.actorId, 'user-1');
  assert.deepEqual(log.verifyIntegrity(), { ok: true, events: 1 });
});

test('hash chain math detects content or ordering changes', () => {
  const log = makeLog();
  const first = log.append({
    actorType: 'user',
    actorId: 'user-1',
    action: 'a.one',
    subjectType: 's',
    subjectId: '1',
  });
  const second = log.append({
    actorType: 'user',
    actorId: 'user-1',
    action: 'a.two',
    subjectType: 's',
    subjectId: '2',
  });
  // A modified field no longer matches the stored hash...
  const { hash: firstHash, ...firstRest } = first;
  assert.notEqual(computeEventHash({ ...firstRest, actorId: 'attacker' }), firstHash);
  // ...and each event is pinned to its predecessor, so reordering breaks too.
  assert.equal(second.previousHash, firstHash);
});

test('query filters by actor, action prefix, facility, and limit', () => {
  const log = makeLog();
  log.append({ actorType: 'user', actorId: 'u1', action: 'break_glass.activated', subjectType: 'break_glass', subjectId: 'bg1', facilityId: 'fac-a' });
  log.append({ actorType: 'user', actorId: 'u2', action: 'break_glass.expired', subjectType: 'break_glass', subjectId: 'bg1', facilityId: 'fac-a' });
  log.append({ actorType: 'user', actorId: 'u1', action: 'session.created', subjectType: 'session', subjectId: 's1' });
  assert.equal(log.query({ actionPrefix: 'break_glass.' }).length, 2);
  assert.equal(log.query({ actorId: 'u1' }).length, 2);
  assert.equal(log.query({ facilityId: 'fac-a' }).length, 2);
  assert.equal(log.query({ limit: 1 }).length, 1);
  assert.equal(log.query({ limit: 1 })[0]?.action, 'session.created');
});

test('rejects blank actor or action', () => {
  const log = makeLog();
  assert.throws(() =>
    log.append({ actorType: 'user', actorId: ' ', action: 'x', subjectType: 's', subjectId: '1' }),
  );
  assert.throws(() =>
    log.append({ actorType: 'user', actorId: 'u', action: '', subjectType: 's', subjectId: '1' }),
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { BreakGlassService } from './breakGlass.js';
import { DevIdentityProvider } from './idp.js';
import { InMemoryUserStore } from './users.js';
import type { UserRecord } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');
const ORG = 'org-armada';

function activeUser(): UserRecord {
  return {
    id: 'user-nurse',
    email: 'nurse.akron@dev.armada.example',
    displayName: 'Synthetic Nurse',
    status: 'active',
    assignments: [{ role: 'nurse', organizationId: ORG, facilityScope: ['fac-akron'] }],
  };
}

function service() {
  const audit = new InMemoryAuditLog({ now: NOW });
  return { audit, svc: new BreakGlassService({ audit, now: NOW }) };
}

test('activation is time-limited and immediately audited with the reason', () => {
  const { audit, svc } = service();
  const activation = svc.activate({
    user: activeUser(),
    organizationId: ORG,
    facilityId: 'fac-columbus',
    reason: 'Covering emergency at Columbus overnight',
    durationMinutes: 30,
    requestId: 'req-1',
  });
  assert.equal(activation.expiresAt, '2026-07-21T12:30:00.000Z');
  const events = audit.query({ action: 'break_glass.activated' });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.actorId, 'user-nurse');
  assert.equal(events[0]?.facilityId, 'fac-columbus');
  assert.equal(events[0]?.breakGlassReason, 'Covering emergency at Columbus overnight');
  assert.equal(events[0]?.requestId, 'req-1');
});

test('rejects short reasons, inactive users, and out-of-range durations', () => {
  const { svc } = service();
  assert.throws(() =>
    svc.activate({ user: activeUser(), organizationId: ORG, facilityId: 'f', reason: 'short' }),
  );
  assert.throws(() =>
    svc.activate({
      user: { ...activeUser(), status: 'suspended' },
      organizationId: ORG,
      facilityId: 'f',
      reason: 'a perfectly valid reason',
    }),
  );
  assert.throws(() =>
    svc.activate({
      user: activeUser(),
      organizationId: ORG,
      facilityId: 'f',
      reason: 'a perfectly valid reason',
      durationMinutes: 999,
    }),
  );
});

test('activeFor honors expiry and facility filters; history feeds review', () => {
  const audit = new InMemoryAuditLog({ now: NOW });
  let t = NOW();
  const svc = new BreakGlassService({ audit, now: () => t, defaultDurationMinutes: 15 });
  svc.activate({
    user: activeUser(),
    organizationId: ORG,
    facilityId: 'fac-columbus',
    reason: 'Covering emergency at Columbus',
  });
  assert.ok(svc.activeFor('user-nurse'));
  assert.ok(svc.activeFor('user-nurse', 'fac-columbus'));
  assert.equal(svc.activeFor('user-nurse', 'fac-cleveland'), undefined);
  assert.equal(svc.activeFor('someone-else'), undefined);
  t = new Date(NOW().getTime() + 16 * 60_000);
  assert.equal(svc.activeFor('user-nurse'), undefined);
  assert.equal(svc.listForReview().length, 1);
});

test('dev identity provider authenticates active synthetic users only', async () => {
  const store = new InMemoryUserStore({ newId: () => 'user-1' });
  store.create({
    email: 'nurse.akron@dev.armada.example',
    displayName: 'Synthetic Nurse',
    assignments: [{ role: 'nurse', organizationId: ORG, facilityScope: ['fac-akron'] }],
  });
  const idp = new DevIdentityProvider({
    nodeEnv: 'development',
    lookupByEmail: (email) => store.getByEmail(email),
  });
  const principal = await idp.authenticate({ email: 'Nurse.Akron@dev.armada.example' });
  assert.ok(principal);
  assert.equal(principal.subject, 'dev|user-1');
  assert.equal(await idp.authenticate({ email: 'nobody@dev.armada.example' }), null);
  store.setStatus('user-1', 'deprovisioned');
  assert.equal(await idp.authenticate({ email: 'nurse.akron@dev.armada.example' }), null);
});

test('dev identity provider refuses to exist in production', () => {
  assert.throws(
    () => new DevIdentityProvider({ nodeEnv: 'production', lookupByEmail: () => undefined }),
    /never be constructed in production/,
  );
});

test('user store validates emails, duplicates, roles, and scopes', () => {
  const store = new InMemoryUserStore();
  const created = store.create({
    email: 'QA.User@dev.armada.example',
    displayName: 'QA User',
    assignments: [{ role: 'quality_risk', organizationId: ORG, facilityScope: 'all' }],
  });
  assert.equal(created.email, 'qa.user@dev.armada.example');
  assert.throws(() => store.create({ email: 'not-an-email', displayName: 'x', assignments: [] }));
  assert.throws(() =>
    store.create({ email: 'qa.user@dev.armada.example', displayName: 'dupe', assignments: [] }),
  );
  assert.throws(() =>
    store.create({
      email: 'bad.role@dev.armada.example',
      displayName: 'x',
      assignments: [
        { role: 'super_admin' as never, organizationId: ORG, facilityScope: 'all' },
      ],
    }),
  );
  assert.throws(() =>
    store.create({
      email: 'empty.scope@dev.armada.example',
      displayName: 'x',
      assignments: [{ role: 'nurse', organizationId: ORG, facilityScope: [] }],
    }),
  );
});

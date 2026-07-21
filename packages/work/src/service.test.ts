import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { InMemoryNotifier } from './notifier.js';
import { WorkItemService, type CreateWorkItemInput } from './service.js';

const BASE = new Date('2026-07-21T12:00:00.000Z');
const ORG = 'org-armada';
const AKRON = 'fac-akron';

function harness(startAt: Date = BASE) {
  let t = startAt;
  let id = 0;
  const audit = new InMemoryAuditLog({ now: () => t });
  const notifier = new InMemoryNotifier({ now: () => t, newId: () => `ntf-${++id}` });
  const service = new WorkItemService({
    audit,
    notifier,
    now: () => t,
    newId: () => `wi-${++id}`,
    escalationPolicy: { toLevel2AfterHours: 4, toLevel3AfterHours: 12 },
  });
  return {
    audit,
    notifier,
    service,
    advanceHours(h: number) {
      t = new Date(t.getTime() + h * 3_600_000);
    },
  };
}

function validInput(overrides: Partial<CreateWorkItemInput> = {}): CreateWorkItemInput {
  return {
    type: 'ur.authorization_expiring',
    title: 'Authorization for episode ep-1 expiring',
    explanation: 'Authorization approaching end date; denial risk without review.',
    organizationId: ORG,
    facilityId: AKRON,
    subjectType: 'treatment_episode',
    subjectId: 'ep-1',
    priority: 'high',
    dueAt: new Date(BASE.getTime() + 8 * 3_600_000).toISOString(),
    ownerRole: 'utilization_review',
    backupRole: 'clinical_director',
    sourceFacts: [
      {
        label: 'Authorization end',
        value: '2026-07-23',
        sourceSystem: 'synthetic-fixture',
        sourceTimestamp: BASE.toISOString(),
      },
    ],
    sourceLinks: [{ label: 'Open episode', href: '/deep-link/kipu/ep-1' }],
    requiredAction: 'Complete concurrent review.',
    createdBy: 'user-creator',
    ...overrides,
  };
}

test('creation enforces explanation, source facts, owner, and required action', () => {
  const { service } = harness();
  assert.throws(() => service.create(validInput({ explanation: ' ' })), /explanation/);
  assert.throws(() => service.create(validInput({ sourceFacts: [] })), /source fact/);
  assert.throws(() => service.create(validInput({ requiredAction: '' })), /requiredAction/);
  assert.throws(() => service.create(validInput({ type: 'BadType' })), /dotted lowercase/);
  assert.throws(() => service.create(validInput({ ownerRole: 'wizard' as never })), /owner role/);
  assert.throws(
    () =>
      service.create(
        validInput({
          sourceFacts: [
            { label: 'x', value: 'y', sourceSystem: 's', sourceTimestamp: 'not-a-date' },
          ],
        }),
      ),
    /sourceTimestamp/,
  );
});

test('creation audits and notifies the owner role without leaking content', () => {
  const { service, audit, notifier } = harness();
  const item = service.create(validInput());
  assert.equal(audit.query({ action: 'work_item.created' }).length, 1);
  const notifications = notifier.all();
  assert.equal(notifications.length, 1);
  const n = notifications[0]!;
  assert.equal(n.recipientRole, 'utilization_review');
  assert.equal(n.workItemId, item.id);
  assert.equal(n.linkPath, `/my-work/${item.id}`);
  // PHI-safety: the notification never carries title/explanation/facts.
  const serialized = JSON.stringify(n);
  assert.ok(!serialized.includes('Authorization for episode'));
  assert.ok(!serialized.includes('denial risk'));
});

test('queue sorts by priority then due time and filters correctly', () => {
  const { service } = harness();
  const late = service.create(
    validInput({ priority: 'medium', dueAt: new Date(BASE.getTime() + 2 * 3_600_000).toISOString(), subjectId: 'ep-2' }),
  );
  const critical = service.create(
    validInput({ priority: 'critical', dueAt: new Date(BASE.getTime() + 9 * 3_600_000).toISOString(), subjectId: 'ep-3' }),
  );
  const soonHigh = service.create(
    validInput({ dueAt: new Date(BASE.getTime() + 1 * 3_600_000).toISOString(), subjectId: 'ep-4' }),
  );
  const queue = service.listQueue({ facilityId: AKRON });
  assert.deepEqual(
    queue.map((i) => i.id),
    [critical.id, soonHigh.id, late.id],
  );
  assert.equal(service.listQueue({ ownerRole: 'utilization_review' }).length, 3);
  assert.equal(service.listQueue({ facilityId: 'fac-other' }).length, 0);
});

test('acknowledge claims ownership; resolve records code; terminal states lock', () => {
  const { service, audit } = harness();
  const item = service.create(validInput());
  const acked = service.acknowledge(item.id, { userId: 'user-ur' });
  assert.equal(acked.status, 'acknowledged');
  assert.equal(acked.ownerUserId, 'user-ur');
  assert.equal(acked.version, 2);
  assert.throws(() => service.acknowledge(item.id, { userId: 'user-2' }), /Only open items/);

  const resolved = service.resolve(item.id, { userId: 'user-ur', code: 'completed' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolution?.code, 'completed');
  assert.throws(() => service.resolve(item.id, { userId: 'x', code: 'completed' }), /no longer change/);
  assert.throws(() => service.escalate(item.id, { byUserId: 'x' }), /no longer change/);
  assert.equal(audit.query({ action: 'work_item.resolved' }).length, 1);
});

test('exception resolutions require a note; unknown codes rejected', () => {
  const { service } = harness();
  const item = service.create(validInput());
  assert.throws(
    () => service.resolve(item.id, { userId: 'u', code: 'unable_to_complete' }),
    /requires an explanatory note/,
  );
  assert.throws(
    () => service.resolve(item.id, { userId: 'u', code: 'made_up' as never }),
    /Unknown resolution code/,
  );
  const ok = service.resolve(item.id, {
    userId: 'u',
    code: 'completed_with_exception',
    note: 'Payer portal was down; confirmed by phone instead.',
  });
  assert.equal(ok.resolution?.note?.includes('Payer portal'), true);
});

test('optimistic locking: stale version is rejected with a reload hint', () => {
  const { service } = harness();
  const item = service.create(validInput());
  service.acknowledge(item.id, { userId: 'a', expectedVersion: 1 });
  assert.throws(
    () => service.resolve(item.id, { userId: 'b', code: 'completed', expectedVersion: 1 }),
    /Version conflict/,
  );
});

test('overdue sweep climbs the ladder: owner → backup → executive', () => {
  const h = harness();
  const item = h.service.create(validInput());
  // Not yet due: nothing happens.
  assert.equal(h.service.sweepEscalations().length, 0);

  // Past due → level 1, owner role re-notified.
  h.advanceHours(9);
  let escalated = h.service.sweepEscalations();
  assert.equal(escalated.length, 1);
  assert.equal(escalated[0]?.escalationLevel, 1);
  assert.equal(escalated[0]?.escalations.at(-1)?.notifiedRole, 'utilization_review');
  // Idempotent at the same level.
  assert.equal(h.service.sweepEscalations().length, 0);

  // 4+ hours overdue → level 2, backup role.
  h.advanceHours(4);
  escalated = h.service.sweepEscalations();
  assert.equal(escalated[0]?.escalationLevel, 2);
  assert.equal(escalated[0]?.escalations.at(-1)?.notifiedRole, 'clinical_director');

  // 12+ hours overdue → level 3, executive.
  h.advanceHours(8);
  escalated = h.service.sweepEscalations();
  assert.equal(escalated[0]?.escalationLevel, 3);
  assert.equal(escalated[0]?.escalations.at(-1)?.notifiedRole, 'executive');

  // Ladder is capped.
  assert.throws(() => h.service.escalate(item.id, { byUserId: 'u' }), /capped/);
  assert.equal(h.audit.query({ action: 'work_item.escalated' }).length, 3);
  // History preserved in order.
  const events = h.service.get(item.id)?.escalations ?? [];
  assert.deepEqual(
    events.map((e) => e.toLevel),
    [1, 2, 3],
  );
});

test('backup role defaults to facility_administrator when unset', () => {
  const h = harness();
  const { backupRole: _backupRole, ...noBackup } = validInput({ dueAt: BASE.toISOString() });
  h.service.create(noBackup);
  h.advanceHours(5);
  const escalated = h.service.sweepEscalations();
  assert.equal(escalated[0]?.escalationLevel, 2);
  assert.equal(escalated[0]?.escalations.at(-1)?.notifiedRole, 'facility_administrator');
});

test('manual escalation records who and why', () => {
  const { service, notifier } = harness();
  const item = service.create(validInput());
  const escalated = service.escalate(item.id, { byUserId: 'user-ur', note: 'Payer unresponsive' });
  const event = escalated.escalations.at(-1);
  assert.equal(event?.reason, 'manual');
  assert.equal(event?.byUserId, 'user-ur');
  assert.equal(event?.note, 'Payer unresponsive');
  assert.equal(notifier.all().length, 2);
});

test('notification listing scopes by role, person, and facility', () => {
  const { service, notifier } = harness();
  const item = service.create(validInput());
  service.acknowledge(item.id, { userId: 'user-ur' });
  service.escalate(item.id, { byUserId: 'user-ur' });

  const urView = notifier.listFor({ roles: ['utilization_review'], facilityIds: [AKRON] });
  assert.ok(urView.length >= 1);
  const wrongFacility = notifier.listFor({ roles: ['utilization_review'], facilityIds: ['fac-x'] });
  assert.equal(wrongFacility.length, 0);
  const wrongRole = notifier.listFor({ roles: ['nurse'], facilityIds: [AKRON] });
  assert.equal(wrongRole.length, 0);
  const personal = notifier.listFor({ roles: [], userId: 'user-ur', facilityIds: 'all' });
  assert.ok(personal.length >= 1);
});

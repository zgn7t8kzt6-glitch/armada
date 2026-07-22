import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccess, POLICY_VERSION } from './policy.js';
import type {
  AccessRequest,
  BreakGlassActivation,
  ResourceRef,
  UserRecord,
} from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');
const ORG = 'org-armada';
const AKRON = 'fac-akron';
const COLUMBUS = 'fac-columbus';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-nurse',
    email: 'nurse.akron@dev.armada.example',
    displayName: 'Synthetic Nurse',
    status: 'active',
    assignments: [{ role: 'nurse', organizationId: ORG, facilityScope: [AKRON] }],
    ...overrides,
  };
}

function resource(overrides: Partial<ResourceRef> = {}): ResourceRef {
  return {
    type: 'patient_summary',
    classification: 'PHI',
    organizationId: ORG,
    facilityId: AKRON,
    ...overrides,
  };
}

function request(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    user: user(),
    resource: resource(),
    action: 'read',
    purpose: 'treatment',
    ...overrides,
  };
}

function decide(overrides: Partial<AccessRequest> = {}) {
  return evaluateAccess(request(overrides), { now: NOW });
}

test('nurse reads PHI patient summary at assigned facility → ALLOW', () => {
  const decision = decide();
  assert.equal(decision.decision, 'ALLOW');
  assert.deepEqual(decision.reasonCodes, ['ROLE_CAPABILITY_MATCH']);
  assert.equal(decision.policyVersion, POLICY_VERSION);
});

test('facility isolation: nurse at Facility A denied Facility B (§24 negative)', () => {
  const decision = decide({ resource: resource({ facilityId: COLUMBUS }) });
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reasonCodes, ['FACILITY_NOT_ASSIGNED']);
});

test('suspended and deprovisioned users are denied everything', () => {
  for (const status of ['suspended', 'deprovisioned'] as const) {
    const decision = decide({ user: user({ status }) });
    assert.equal(decision.decision, 'DENY');
    assert.deepEqual(decision.reasonCodes, ['USER_INACTIVE']);
  }
});

test('organization mismatch is denied before anything else leaks', () => {
  const decision = decide({ resource: resource({ organizationId: 'org-other' }) });
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reasonCodes, ['ORGANIZATION_MISMATCH']);
});

test('Part 2 data is default-deny for every role, purpose, and break-glass', () => {
  const bg: BreakGlassActivation = {
    id: 'bg-1',
    userId: 'user-nurse',
    organizationId: ORG,
    facilityId: AKRON,
    reason: 'emergency situation',
    activatedAt: NOW().toISOString(),
    expiresAt: new Date(NOW().getTime() + 600_000).toISOString(),
  };
  const decision = decide({
    resource: resource({ classification: 'PART2' }),
    breakGlass: bg,
  });
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reasonCodes, ['PART2_CONSENT_UNAVAILABLE']);
});

test('Part 2 with consent-service ALLOW proceeds through role/facility checks', () => {
  const allowed = decide({
    resource: resource({ classification: 'PART2' }),
    consentDecision: 'ALLOW',
  });
  assert.equal(allowed.decision, 'ALLOW');
  assert.ok(allowed.reasonCodes.includes('PART2_CONSENT_APPLIED'));
  // Consent does not bypass facility isolation.
  const wrongFacility = decide({
    resource: resource({ classification: 'PART2', facilityId: COLUMBUS }),
    consentDecision: 'ALLOW',
  });
  assert.equal(wrongFacility.decision, 'DENY');
  // REQUIRE_REVIEW and DENY both keep the gate closed.
  for (const consentDecision of ['REQUIRE_REVIEW', 'DENY'] as const) {
    const denied = decide({
      resource: resource({ classification: 'PART2' }),
      consentDecision,
    });
    assert.equal(denied.decision, 'DENY');
    assert.deepEqual(denied.reasonCodes, ['PART2_CONSENT_UNAVAILABLE']);
  }
});

test('role without capability is denied: nurse cannot read audit events', () => {
  const decision = decide({ resource: resource({ type: 'audit_event' }) });
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reasonCodes, ['ROLE_LACKS_CAPABILITY']);
});

test('classification ceiling: sysadmin reads operational audit events, not PHI ones', () => {
  const admin = user({
    id: 'user-admin',
    assignments: [{ role: 'system_administrator', organizationId: ORG, facilityScope: 'all' }],
  });
  const operational = decide({
    user: admin,
    resource: resource({ type: 'audit_event', classification: 'OPERATIONAL', facilityId: AKRON }),
    purpose: 'operations',
  });
  assert.equal(operational.decision, 'ALLOW');
  const phi = decide({
    user: admin,
    resource: resource({ type: 'audit_event', classification: 'PHI', facilityId: AKRON }),
    purpose: 'operations',
  });
  assert.equal(phi.decision, 'DENY');
  assert.deepEqual(phi.reasonCodes, ['CLASSIFICATION_EXCEEDS_ROLE']);
});

test('org-wide resources need org-wide scope: facility-scoped role denied', () => {
  const privacy = user({
    id: 'user-privacy',
    assignments: [{ role: 'privacy_administrator', organizationId: ORG, facilityScope: 'all' }],
  });
  const orgWide = resource({ type: 'access_review', classification: 'PHI' });
  delete (orgWide as { facilityId?: string }).facilityId;
  assert.equal(decide({ user: privacy, resource: orgWide, purpose: 'audit' }).decision, 'ALLOW');
  const scoped = user({
    id: 'user-qr',
    assignments: [{ role: 'quality_risk', organizationId: ORG, facilityScope: [AKRON] }],
  });
  const denied = decide({ user: scoped, resource: orgWide, purpose: 'audit' });
  assert.equal(denied.decision, 'DENY');
  assert.deepEqual(denied.reasonCodes, ['FACILITY_NOT_ASSIGNED']);
});

test('writes require write capability: executive cannot write work items', () => {
  const exec = user({
    id: 'user-exec',
    assignments: [{ role: 'executive', organizationId: ORG, facilityScope: 'all' }],
  });
  const read = decide({
    user: exec,
    resource: resource({ type: 'work_item', classification: 'OPERATIONAL' }),
    action: 'read',
    purpose: 'operations',
  });
  assert.equal(read.decision, 'ALLOW');
  const write = decide({
    user: exec,
    resource: resource({ type: 'work_item', classification: 'OPERATIONAL' }),
    action: 'write',
    purpose: 'operations',
  });
  assert.equal(write.decision, 'DENY');
});

function activeBreakGlass(overrides: Partial<BreakGlassActivation> = {}): BreakGlassActivation {
  return {
    id: 'bg-1',
    userId: 'user-nurse',
    organizationId: ORG,
    facilityId: COLUMBUS,
    reason: 'emergency coverage situation',
    activatedAt: NOW().toISOString(),
    expiresAt: new Date(NOW().getTime() + 600_000).toISOString(),
    ...overrides,
  };
}

test('break-glass allows PHI read at the granted facility, with obligations', () => {
  const decision = decide({
    resource: resource({ facilityId: COLUMBUS }),
    purpose: 'break_glass',
    breakGlass: activeBreakGlass(),
  });
  assert.equal(decision.decision, 'ALLOW');
  assert.deepEqual(decision.reasonCodes, ['BREAK_GLASS_APPLIED']);
  assert.ok(decision.obligations.includes('PRIVACY_REVIEW_QUEUED'));
  assert.ok(decision.obligations.includes('ACCESS_MONITORED_NOTICE'));
});

test('expired break-glass no longer grants anything (§24: expired one second earlier)', () => {
  const decision = decide({
    resource: resource({ facilityId: COLUMBUS }),
    purpose: 'break_glass',
    breakGlass: activeBreakGlass({ expiresAt: new Date(NOW().getTime() - 1000).toISOString() }),
  });
  assert.equal(decision.decision, 'DENY');
  assert.ok(decision.reasonCodes.includes('BREAK_GLASS_INAPPLICABLE'));
});

test('break-glass never unlocks writes, other facilities, or other users', () => {
  const write = decide({
    resource: resource({ facilityId: COLUMBUS }),
    action: 'write',
    purpose: 'break_glass',
    breakGlass: activeBreakGlass(),
  });
  assert.equal(write.decision, 'DENY');
  const wrongFacility = decide({
    resource: resource({ facilityId: 'fac-cleveland' }),
    purpose: 'break_glass',
    breakGlass: activeBreakGlass(),
  });
  assert.equal(wrongFacility.decision, 'DENY');
  const wrongUser = decide({
    resource: resource({ facilityId: COLUMBUS }),
    purpose: 'break_glass',
    breakGlass: activeBreakGlass({ userId: 'someone-else' }),
  });
  assert.equal(wrongUser.decision, 'DENY');
});

test('every decision carries policy version and evaluation timestamp', () => {
  const decision = decide();
  assert.equal(decision.policyVersion, POLICY_VERSION);
  assert.equal(decision.evaluatedAt, NOW().toISOString());
});

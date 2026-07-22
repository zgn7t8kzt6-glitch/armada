import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { ConsentDecisionService, type ConsentDecisionInput } from './index.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');

function harness(matrixVersion?: string) {
  let id = 0;
  const audit = new InMemoryAuditLog({ now: NOW });
  const service = new ConsentDecisionService({
    audit,
    now: NOW,
    newId: () => `cd-${++id}`,
    ...(matrixVersion !== undefined ? { legalApprovedMatrixVersion: matrixVersion } : {}),
  });
  return { audit, service };
}

function part2Request(overrides: Partial<ConsentDecisionInput> = {}): ConsentDecisionInput {
  return {
    personId: 'person-1',
    dataCategory: 'sud_treatment_records',
    sourceSystem: 'KIPU',
    destination: 'payer-portal',
    purpose: 'payment',
    requestorId: 'user-ur',
    facilityId: 'fac-akron',
    ...overrides,
  };
}

function coveringDirective(service: ConsentDecisionService, overrides: Record<string, unknown> = {}) {
  return service.recordDirective({
    personId: 'person-1',
    categories: ['sud_treatment_records'],
    purposes: ['payment'],
    recipients: ['payer-portal'],
    effectiveAt: '2026-07-01T00:00:00.000Z',
    policyBasis: '42 CFR Part 2 written consent (synthetic test)',
    recordedBy: 'user-privacy',
    ...overrides,
  });
}

test('decision table: Part 2 with no directive → DENY (§24 negative)', () => {
  const { service } = harness();
  const decision = service.evaluate(part2Request());
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reason_codes, ['PART2_NO_CONSENT_DIRECTIVE']);
  assert.equal(decision.consent_directive_id, null);
});

test('decision table: covering directive without legal matrix → REQUIRE_REVIEW, never ALLOW', () => {
  const { service } = harness();
  const directive = coveringDirective(service);
  const decision = service.evaluate(part2Request());
  assert.equal(decision.decision, 'REQUIRE_REVIEW');
  assert.deepEqual(decision.reason_codes, ['PART2_LEGAL_MATRIX_PENDING']);
  assert.equal(decision.consent_directive_id, directive.id);
  assert.ok(decision.obligations.includes('PRIVACY_OFFICER_REVIEW_REQUIRED'));
  assert.match(decision.policy_version, /pending-legal-approval/);
});

test('decision table: directive must cover category, purpose, AND recipient', () => {
  const { service } = harness();
  coveringDirective(service);
  assert.equal(service.evaluate(part2Request({ purpose: 'operations' })).decision, 'DENY');
  assert.equal(service.evaluate(part2Request({ destination: 'other-system' })).decision, 'DENY');
  assert.equal(service.evaluate(part2Request({ personId: 'person-2' })).decision, 'DENY');
});

test('decision table: consent expired one second earlier → DENY (§24 negative)', () => {
  const { service } = harness();
  coveringDirective(service, { expiresAt: '2026-07-21T11:59:59.000Z' });
  const decision = service.evaluate(part2Request());
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reason_codes, ['PART2_CONSENT_EXPIRED']);
});

test('decision table: revocation affects future exchanges; audit retained', () => {
  const { service, audit } = harness();
  const directive = coveringDirective(service);
  service.revokeDirective(directive.id, 'user-privacy');
  const decision = service.evaluate(part2Request());
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reason_codes, ['PART2_CONSENT_REVOKED']);
  // The directive record and its audit trail survive revocation (§10.3).
  assert.equal(service.directivesFor('person-1').length, 1);
  assert.equal(audit.query({ action: 'consent.directive_revoked' }).length, 1);
  assert.throws(() => service.revokeDirective(directive.id, 'x'), /already revoked/);
});

test('decision table: with an approved legal matrix, a covering directive can ALLOW', () => {
  const { service } = harness('consent-matrix/1.0.0-legal-approved');
  coveringDirective(service);
  const decision = service.evaluate(part2Request());
  assert.equal(decision.decision, 'ALLOW');
  assert.deepEqual(decision.reason_codes, ['PART2_CONSENT_DIRECTIVE_COVERS']);
  assert.equal(decision.policy_version, 'consent-matrix/1.0.0-legal-approved');
  assert.ok(decision.obligations.includes('NO_REDISCLOSURE_NOTICE_REQUIRED'));
});

test('non-Part-2 categories defer to RBAC; unclassified is default-deny', () => {
  const { service } = harness();
  const operational = service.evaluate(part2Request({ dataCategory: 'operational' }));
  assert.equal(operational.decision, 'ALLOW');
  assert.deepEqual(operational.reason_codes, ['NOT_PART2_GOVERNED']);
  assert.ok(operational.minimum_necessary_fields.length > 0);
  const unclassified = service.evaluate(part2Request({ dataCategory: 'genome' as never }));
  assert.equal(unclassified.decision, 'DENY');
  assert.deepEqual(unclassified.reason_codes, ['UNCLASSIFIED_DATA_CATEGORY']);
});

test('every decision is audited with codes, never payloads; directives validated', () => {
  const { service, audit } = harness();
  service.evaluate(part2Request());
  const events = audit.query({ action: 'consent.decision_evaluated' });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.policyDecision, 'DENY:PART2_NO_CONSENT_DIRECTIVE');
  assert.throws(
    () =>
      service.recordDirective({
        personId: 'p',
        categories: [],
        purposes: ['payment'],
        recipients: ['x'],
        effectiveAt: '2026-01-01T00:00:00.000Z',
        policyBasis: 'x',
        recordedBy: 'u',
      }),
    /requires categories/,
  );
  assert.throws(
    () =>
      service.recordDirective({
        personId: 'p',
        categories: ['billing'],
        purposes: ['payment'],
        recipients: ['x'],
        effectiveAt: 'not-a-date',
        policyBasis: 'x',
        recordedBy: 'u',
      }),
    /effectiveAt/,
  );
});

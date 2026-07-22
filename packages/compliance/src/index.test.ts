import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { ComplianceService, seedComplianceRequirements } from './index.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');

function harness() {
  let id = 0;
  const audit = new InMemoryAuditLog({ now: NOW });
  const service = new ComplianceService({ audit, now: NOW, newId: () => `cr-${++id}` });
  return { audit, service };
}

test('requirements are validated structured records with citations, audited', () => {
  const { service, audit } = harness();
  const requirements = seedComplianceRequirements(service, 'user-compliance');
  assert.equal(requirements.length, 4);
  assert.equal(service.requirements({ authority: 'HIPAA' }).length, 1);
  assert.equal(service.requirements({ responsibleRole: 'privacy_administrator' }).length, 1);
  assert.equal(audit.query({ action: 'compliance.requirement_added' }).length, 4);
  assert.throws(
    () =>
      service.addRequirement({
        authority: 'FDA' as never,
        citation: 'x',
        applicability: 'x',
        summary: 'x',
        responsibleDepartment: 'x',
        responsibleRole: 'quality_risk',
        policyRefs: [],
        procedureRefs: [],
        evidenceExamples: [],
        auditMethod: 'x',
        reviewFrequencyMonths: 12,
        riskRating: 'high',
        createdBy: 'u',
      }),
    /Unknown authority/,
  );
});

test('evidence links artifacts to requirements; unknown requirement rejected', () => {
  const { service, audit } = harness();
  const [first] = seedComplianceRequirements(service, 'user-compliance');
  const evidence = service.recordEvidence({
    requirementId: first!.id,
    type: 'audit_event',
    reference: 'evt-12345',
    description: 'Audit-log integrity verification run (synthetic)',
    collectedBy: 'user-quality',
  });
  assert.equal(service.evidenceFor(first!.id).length, 1);
  assert.equal(evidence.type, 'audit_event');
  assert.equal(audit.query({ action: 'compliance.evidence_recorded' }).length, 1);
  assert.throws(
    () =>
      service.recordEvidence({
        requirementId: 'cr-nope',
        type: 'document',
        reference: 'x',
        description: 'x',
        collectedBy: 'u',
      }),
    /Unknown requirement/,
  );
});

test('corrective actions: open, close with note, overdue tracking', () => {
  const { service } = harness();
  const [first] = seedComplianceRequirements(service, 'user-compliance');
  const action = service.openCorrectiveAction({
    requirementId: first!.id,
    findingSummary: 'Tracer found missing handoff documentation on two shifts',
    ownerRole: 'nursing_director',
    dueDate: '2026-07-10',
    openedBy: 'user-quality',
  });
  assert.equal(action.status, 'open');
  assert.throws(
    () => service.closeCorrectiveAction(action.id, { closedBy: 'u', closureNote: 'ok' }),
    /explanatory note/,
  );
  const summary = service.readinessSummary();
  assert.equal(summary.correctiveActions.open, 1);
  assert.equal(summary.correctiveActions.overdue, 1, 'past due date counts as overdue');
  const closed = service.closeCorrectiveAction(action.id, {
    closedBy: 'user-quality',
    closureNote: 'Handoff standard work retrained; two clean tracer passes verified.',
  });
  assert.equal(closed.status, 'closed');
  assert.throws(
    () => service.closeCorrectiveAction(action.id, { closedBy: 'u', closureNote: 'already done...' }),
    /already closed/,
  );
});

test('readiness summary rolls up evidence coverage, overdue reviews, audits', () => {
  const { service } = harness();
  const requirements = seedComplianceRequirements(service, 'user-compliance');
  service.recordEvidence({
    requirementId: requirements[1]!.id,
    type: 'audit_event',
    reference: 'evt-1',
    description: 'integrity check',
    collectedBy: 'u',
  });
  service.scheduleAudit({
    name: 'Mock Joint Commission tracer',
    authority: 'JointCommission',
    scheduledFor: '2026-09-01',
    requirementIds: [requirements[3]!.id],
  });
  const summary = service.readinessSummary();
  const hipaa = summary.byAuthority.find((a) => a.authority === 'HIPAA');
  assert.equal(hipaa?.withEvidence, 1);
  assert.equal(hipaa?.highRiskWithoutEvidence, 0);
  const part2 = summary.byAuthority.find((a) => a.authority === 'Part2');
  assert.equal(part2?.withEvidence, 0);
  assert.equal(part2?.highRiskWithoutEvidence, 1, 'high-risk gap surfaced');
  assert.equal(summary.upcomingAudits.length, 1);
  // Freshly created requirements are not yet overdue for review.
  assert.ok(summary.byAuthority.every((a) => a.reviewsOverdue === 0));
});

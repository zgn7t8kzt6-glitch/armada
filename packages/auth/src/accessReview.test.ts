import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAccessReviewReport } from './accessReview.js';
import type { BreakGlassActivation, UserRecord } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');
const ORG = 'org-armada';

const USERS: readonly UserRecord[] = [
  {
    id: 'u1',
    email: 'privacy@dev.armada.example',
    displayName: 'Privacy Admin',
    status: 'active',
    assignments: [{ role: 'privacy_administrator', organizationId: ORG, facilityScope: 'all' }],
  },
  {
    id: 'u2',
    email: 'nurse.akron@dev.armada.example',
    displayName: 'Nurse',
    status: 'active',
    assignments: [{ role: 'nurse', organizationId: ORG, facilityScope: ['fac-akron'] }],
  },
  {
    id: 'u3',
    email: 'former@dev.armada.example',
    displayName: 'Former Employee',
    status: 'deprovisioned',
    assignments: [{ role: 'admissions', organizationId: ORG, facilityScope: ['fac-akron'] }],
  },
];

const BG: readonly BreakGlassActivation[] = [
  {
    id: 'bg1',
    userId: 'u2',
    organizationId: ORG,
    facilityId: 'fac-columbus',
    reason: 'Emergency overnight coverage',
    activatedAt: '2026-07-21T11:00:00.000Z',
    expiresAt: '2026-07-21T11:30:00.000Z',
  },
  {
    id: 'bg2',
    userId: 'u2',
    organizationId: ORG,
    facilityId: 'fac-columbus',
    reason: 'Second emergency coverage',
    activatedAt: '2026-07-21T11:50:00.000Z',
    expiresAt: '2026-07-21T12:20:00.000Z',
  },
];

test('report totals, role counts, org-wide flags, and break-glass activity are correct', () => {
  const report = generateAccessReviewReport({ users: USERS, breakGlassActivations: BG, now: NOW });
  assert.equal(report.generatedAt, NOW().toISOString());
  assert.deepEqual(report.totals, { users: 3, active: 2, suspended: 0, deprovisioned: 1 });
  assert.equal(report.roleCounts.nurse, 1);
  assert.equal(report.roleCounts.privacy_administrator, 1);
  assert.equal(report.assignments.length, 3);
  assert.deepEqual(
    report.orgWideAssignments.map((a) => a.userId),
    ['u1'],
  );
  assert.equal(report.breakGlass.total, 2);
  assert.equal(report.breakGlass.activeNow, 1);
});

test('deprovisioned users with lingering assignments still appear for review', () => {
  const report = generateAccessReviewReport({ users: USERS, breakGlassActivations: [], now: NOW });
  const former = report.assignments.filter((a) => a.userId === 'u3');
  assert.equal(former.length, 1);
  assert.equal(former[0]?.status, 'deprovisioned');
});

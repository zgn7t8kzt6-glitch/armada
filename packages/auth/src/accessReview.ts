import type { BaselineRole } from './roles.js';
import type { BreakGlassActivation, UserRecord } from './types.js';

/**
 * Access review report (blueprint §27 Epic 2: "Access review reports").
 * Feeds the periodic human access-review procedure: who has what, where,
 * plus every break-glass grant in the period. Pure function over the stores.
 */

export interface AccessReviewInput {
  readonly users: readonly UserRecord[];
  readonly breakGlassActivations: readonly BreakGlassActivation[];
  readonly now?: () => Date;
}

export interface AssignmentRow {
  readonly userId: string;
  readonly email: string;
  readonly status: string;
  readonly role: BaselineRole;
  readonly organizationId: string;
  readonly facilityScope: 'all' | readonly string[];
}

export interface AccessReviewReport {
  readonly generatedAt: string;
  readonly totals: {
    readonly users: number;
    readonly active: number;
    readonly suspended: number;
    readonly deprovisioned: number;
  };
  readonly roleCounts: Readonly<Partial<Record<BaselineRole, number>>>;
  /** Assignments with organization-wide scope deserve extra scrutiny. */
  readonly orgWideAssignments: readonly AssignmentRow[];
  readonly assignments: readonly AssignmentRow[];
  readonly breakGlass: {
    readonly total: number;
    readonly activeNow: number;
    readonly events: readonly BreakGlassActivation[];
  };
}

export function generateAccessReviewReport(input: AccessReviewInput): AccessReviewReport {
  const now = (input.now ?? (() => new Date()))();

  const assignments: AssignmentRow[] = [];
  const roleCounts: Partial<Record<BaselineRole, number>> = {};
  let active = 0;
  let suspended = 0;
  let deprovisioned = 0;

  for (const user of input.users) {
    if (user.status === 'active') active += 1;
    else if (user.status === 'suspended') suspended += 1;
    else deprovisioned += 1;
    for (const a of user.assignments) {
      assignments.push({
        userId: user.id,
        email: user.email,
        status: user.status,
        role: a.role,
        organizationId: a.organizationId,
        facilityScope: a.facilityScope,
      });
      roleCounts[a.role] = (roleCounts[a.role] ?? 0) + 1;
    }
  }

  const activeNow = input.breakGlassActivations.filter(
    (b) => new Date(b.expiresAt).getTime() > now.getTime(),
  ).length;

  return {
    generatedAt: now.toISOString(),
    totals: { users: input.users.length, active, suspended, deprovisioned },
    roleCounts,
    orgWideAssignments: assignments.filter((a) => a.facilityScope === 'all'),
    assignments,
    breakGlass: {
      total: input.breakGlassActivations.length,
      activeNow,
      events: input.breakGlassActivations,
    },
  };
}

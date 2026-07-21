import { ROLE_CAPABILITY_MATRIX, type AccessAction } from './roles.js';
import {
  CLASSIFICATION_RANK,
  type AccessDecision,
  type AccessReasonCode,
  type AccessRequest,
  type BreakGlassActivation,
  type DataClassification,
  type ResourceRef,
  type RoleAssignment,
} from './types.js';

/**
 * Policy-based access control engine (blueprint §11, ADR-0006).
 *
 * Pure and deterministic: same request + clock, same decision. Default deny —
 * an ALLOW requires an explicit chain of matches (active user → organization
 * → facility coverage → role capability → classification ceiling), or a
 * valid break-glass grant. Every decision is explainable via reason codes
 * and stamped with the policy version.
 */

export const POLICY_VERSION = 'aip-policy/0.2.0-epic2';

export interface PolicyOptions {
  readonly now?: () => Date;
}

function deny(codes: readonly AccessReasonCode[], now: Date): AccessDecision {
  return {
    decision: 'DENY',
    reasonCodes: codes,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now.toISOString(),
    obligations: [],
  };
}

function allow(
  codes: readonly AccessReasonCode[],
  now: Date,
  obligations: readonly string[] = [],
): AccessDecision {
  return {
    decision: 'ALLOW',
    reasonCodes: codes,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now.toISOString(),
    obligations,
  };
}

/** Does this assignment's facility scope cover the resource? */
function coversFacility(assignment: RoleAssignment, resource: ResourceRef): boolean {
  if (assignment.organizationId !== resource.organizationId) return false;
  if (assignment.facilityScope === 'all') return true;
  // Organization-wide resources (no facilityId) need organization-wide scope.
  if (resource.facilityId === undefined) return false;
  return assignment.facilityScope.includes(resource.facilityId);
}

function capabilityCeiling(
  assignment: RoleAssignment,
  resourceType: ResourceRef['type'],
  action: AccessAction,
): DataClassification | undefined {
  return ROLE_CAPABILITY_MATRIX[assignment.role][resourceType]?.[action];
}

function breakGlassApplies(
  breakGlass: BreakGlassActivation | undefined,
  request: AccessRequest,
  now: Date,
): boolean {
  if (breakGlass === undefined) return false;
  return (
    breakGlass.userId === request.user.id &&
    breakGlass.organizationId === request.resource.organizationId &&
    request.resource.facilityId !== undefined &&
    breakGlass.facilityId === request.resource.facilityId &&
    new Date(breakGlass.expiresAt).getTime() > now.getTime() &&
    // Break-glass is an emergency READ mechanism for PHI at most. It never
    // unlocks writes and never overrides the Part 2 consent gate.
    request.action === 'read' &&
    request.resource.classification !== 'PART2'
  );
}

export function evaluateAccess(request: AccessRequest, options: PolicyOptions = {}): AccessDecision {
  const now = (options.now ?? (() => new Date()))();
  const { user, resource, action, purpose } = request;

  if (user.status !== 'active') {
    return deny(['USER_INACTIVE'], now);
  }

  const orgAssignments = user.assignments.filter(
    (a) => a.organizationId === resource.organizationId,
  );
  if (orgAssignments.length === 0) {
    return deny(['ORGANIZATION_MISMATCH'], now);
  }

  // Part 2 stays default-deny until the consent decision service (Epic 13)
  // provides a legally approved ALLOW — no role or break-glass overrides this.
  if (resource.classification === 'PART2') {
    return deny(['PART2_CONSENT_UNAVAILABLE'], now);
  }

  // Purpose 'break_glass' is only coherent alongside an applicable grant.
  const breakGlassActive = breakGlassApplies(request.breakGlass, request, now);
  if (purpose === 'break_glass' && !breakGlassActive) {
    return deny(['PURPOSE_INVALID', 'BREAK_GLASS_INAPPLICABLE'], now);
  }

  const covering = orgAssignments.filter((a) => coversFacility(a, resource));
  if (covering.length === 0) {
    if (breakGlassActive) {
      return allow(['BREAK_GLASS_APPLIED'], now, [
        'ACCESS_MONITORED_NOTICE',
        'PRIVACY_REVIEW_QUEUED',
      ]);
    }
    return deny(['FACILITY_NOT_ASSIGNED'], now);
  }

  let sawCapability = false;
  for (const assignment of covering) {
    const ceiling = capabilityCeiling(assignment, resource.type, action);
    if (ceiling === undefined) continue;
    sawCapability = true;
    if (CLASSIFICATION_RANK[ceiling] >= CLASSIFICATION_RANK[resource.classification]) {
      return allow(['ROLE_CAPABILITY_MATCH'], now);
    }
  }

  if (breakGlassActive) {
    return allow(['BREAK_GLASS_APPLIED'], now, [
      'ACCESS_MONITORED_NOTICE',
      'PRIVACY_REVIEW_QUEUED',
    ]);
  }

  return deny([sawCapability ? 'CLASSIFICATION_EXCEEDS_ROLE' : 'ROLE_LACKS_CAPABILITY'], now);
}

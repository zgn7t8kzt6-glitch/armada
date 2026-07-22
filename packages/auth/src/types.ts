import type { AccessAction, BaselineRole, ResourceType } from './roles.js';

/** Data classification tiers (blueprint §8, §11). Order matters: each tier
 * includes everything below it. */
export const DATA_CLASSIFICATIONS = ['OPERATIONAL', 'PHI', 'PART2'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  OPERATIONAL: 0,
  PHI: 1,
  PART2: 2,
};

/** Purpose of use accompanies every access request (blueprint §11, §10.1). */
export const PURPOSES_OF_USE = [
  'treatment',
  'payment',
  'operations',
  'audit',
  'break_glass',
] as const;
export type PurposeOfUse = (typeof PURPOSES_OF_USE)[number];

/** Identity asserted by an identity provider (OIDC-shaped claims subset). */
export interface Principal {
  /** IdP subject claim — stable, opaque. */
  readonly subject: string;
  readonly issuer: string;
  readonly email: string;
  readonly displayName: string;
}

/** Assignment of a role within an organization, scoped to facilities.
 * `all` grants organization-wide coverage and is reserved for governance
 * and executive roles; facility staff get explicit facility lists. */
export interface RoleAssignment {
  readonly role: BaselineRole;
  readonly organizationId: string;
  readonly facilityScope: 'all' | readonly string[];
}

export type UserStatus = 'active' | 'suspended' | 'deprovisioned';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly assignments: readonly RoleAssignment[];
  /** IdP linkage, set on first login. */
  readonly idpSubject?: string;
}

export interface ResourceRef {
  readonly type: ResourceType;
  readonly classification: DataClassification;
  readonly organizationId: string;
  /** Absent means an organization-wide resource (requires `all` scope). */
  readonly facilityId?: string;
}

export interface BreakGlassActivation {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly reason: string;
  readonly activatedAt: string;
  readonly expiresAt: string;
}

export interface AccessRequest {
  readonly user: UserRecord;
  readonly resource: ResourceRef;
  readonly action: AccessAction;
  readonly purpose: PurposeOfUse;
  /** Active break-glass grant for this user, if any. */
  readonly breakGlass?: BreakGlassActivation;
  /**
   * Outcome of the consent decision service (Epic 13) for this request.
   * PART2 resources are denied unless this is exactly 'ALLOW' — and the
   * consent service itself cannot say ALLOW until the legally approved
   * decision matrix ships, so Part 2 stays fail-closed end to end.
   */
  readonly consentDecision?: 'ALLOW' | 'DENY' | 'REQUIRE_REVIEW';
}

export type AccessReasonCode =
  | 'USER_INACTIVE'
  | 'ORGANIZATION_MISMATCH'
  | 'PART2_CONSENT_UNAVAILABLE'
  | 'FACILITY_NOT_ASSIGNED'
  | 'ROLE_LACKS_CAPABILITY'
  | 'CLASSIFICATION_EXCEEDS_ROLE'
  | 'PURPOSE_INVALID'
  | 'ROLE_CAPABILITY_MATCH'
  | 'PART2_CONSENT_APPLIED'
  | 'BREAK_GLASS_APPLIED'
  | 'BREAK_GLASS_INAPPLICABLE';

export interface AccessDecision {
  readonly decision: 'ALLOW' | 'DENY';
  readonly reasonCodes: readonly AccessReasonCode[];
  readonly policyVersion: string;
  readonly evaluatedAt: string;
  /** Duties attached to an ALLOW (e.g. monitoring notice on break-glass). */
  readonly obligations: readonly string[];
}

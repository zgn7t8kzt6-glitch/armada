/**
 * Baseline roles (blueprint §11) and their coarse capability matrix.
 *
 * A role alone is never sufficient: the policy engine additionally requires
 * organization match, facility coverage, classification ceiling, and an
 * accepted purpose. Part 2 data is not grantable through this matrix at all —
 * it stays default-deny until the consent decision service (Epic 13) exists.
 */

export const BASELINE_ROLES = [
  'system_administrator',
  'privacy_administrator',
  'compliance_administrator',
  'executive',
  'facility_administrator',
  'medical_director',
  'provider',
  'nursing_director',
  'nurse',
  'clinical_director',
  'therapist_counselor',
  'case_manager',
  'bht_recovery_support',
  'admissions',
  'utilization_review',
  'revenue_cycle',
  'quality_risk',
  'hr_learning',
  'facilities_environmental_services',
  'read_only_auditor',
] as const;

export type BaselineRole = (typeof BASELINE_ROLES)[number];

export function isBaselineRole(value: string): value is BaselineRole {
  return (BASELINE_ROLES as readonly string[]).includes(value);
}

/** Resource families the platform knows about so far; grows with the epics. */
export const RESOURCE_TYPES = [
  'patient_summary',
  'census_summary',
  'work_item',
  'audit_event',
  'access_review',
  'admin_config',
  'excellence_content',
  'identity_reconciliation',
  'daily_lineup',
  'compliance_registry',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type AccessAction = 'read' | 'write';

/** Classification ceiling a capability may reach. PART2 is never grantable here. */
export type ClassificationCeiling = 'OPERATIONAL' | 'PHI';

export interface Capability {
  readonly read?: ClassificationCeiling;
  readonly write?: ClassificationCeiling;
}

export type RoleCapabilities = Partial<Record<ResourceType, Capability>>;

/** Every role can read the Excellence library — Gold Standards, role cards,
 * and policies are for the whole workforce (blueprint §15). */
const EXCELLENCE_READ: RoleCapabilities = {
  excellence_content: { read: 'OPERATIONAL' },
};

/** Content-governance roles may author/edit Excellence content. */
const EXCELLENCE_WRITE: RoleCapabilities = {
  excellence_content: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
};

const CLINICAL_CORE: RoleCapabilities = {
  patient_summary: { read: 'PHI' },
  census_summary: { read: 'OPERATIONAL' },
  work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  daily_lineup: { read: 'OPERATIONAL' },
  ...EXCELLENCE_READ,
};

/** Leadership roles that run the daily lineup (edit, approve, publish). */
const LINEUP_LEAD: RoleCapabilities = {
  daily_lineup: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
};

/**
 * Minimum-necessary matrix (blueprint §2.3): system administrators configure
 * the platform but do not read PHI; executives see operational rollups, not
 * charts; support roles see work items, not summaries.
 */
export const ROLE_CAPABILITY_MATRIX: Record<BaselineRole, RoleCapabilities> = {
  system_administrator: {
    admin_config: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    audit_event: { read: 'OPERATIONAL' },
    ...EXCELLENCE_READ,
  },
  privacy_administrator: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
    identity_reconciliation: { read: 'PHI', write: 'PHI' },
    ...EXCELLENCE_READ,
  },
  compliance_administrator: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
    identity_reconciliation: { read: 'PHI', write: 'PHI' },
    compliance_registry: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...EXCELLENCE_WRITE,
  },
  executive: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL' },
    compliance_registry: { read: 'OPERATIONAL' },
    ...LINEUP_LEAD,
    ...EXCELLENCE_WRITE,
  },
  facility_administrator: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...LINEUP_LEAD,
    ...EXCELLENCE_WRITE,
  },
  medical_director: CLINICAL_CORE,
  provider: CLINICAL_CORE,
  nursing_director: { ...CLINICAL_CORE, ...LINEUP_LEAD, ...EXCELLENCE_WRITE },
  nurse: CLINICAL_CORE,
  clinical_director: { ...CLINICAL_CORE, ...LINEUP_LEAD, ...EXCELLENCE_WRITE },
  therapist_counselor: CLINICAL_CORE,
  case_manager: CLINICAL_CORE,
  bht_recovery_support: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    daily_lineup: { read: 'OPERATIONAL' },
    ...EXCELLENCE_READ,
  },
  admissions: CLINICAL_CORE,
  utilization_review: CLINICAL_CORE,
  revenue_cycle: {
    patient_summary: { read: 'PHI' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...EXCELLENCE_READ,
  },
  quality_risk: {
    patient_summary: { read: 'PHI' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    audit_event: { read: 'PHI' },
    identity_reconciliation: { read: 'PHI', write: 'PHI' },
    compliance_registry: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...LINEUP_LEAD,
    ...EXCELLENCE_WRITE,
  },
  hr_learning: {
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...EXCELLENCE_WRITE,
  },
  facilities_environmental_services: {
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    ...EXCELLENCE_READ,
  },
  read_only_auditor: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
    census_summary: { read: 'OPERATIONAL' },
    identity_reconciliation: { read: 'PHI' },
    daily_lineup: { read: 'OPERATIONAL' },
    compliance_registry: { read: 'OPERATIONAL' },
    ...EXCELLENCE_READ,
  },
};

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

const CLINICAL_CORE: RoleCapabilities = {
  patient_summary: { read: 'PHI' },
  census_summary: { read: 'OPERATIONAL' },
  work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
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
  },
  privacy_administrator: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
  },
  compliance_administrator: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
  },
  executive: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL' },
  },
  facility_administrator: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  },
  medical_director: CLINICAL_CORE,
  provider: CLINICAL_CORE,
  nursing_director: CLINICAL_CORE,
  nurse: CLINICAL_CORE,
  clinical_director: CLINICAL_CORE,
  therapist_counselor: CLINICAL_CORE,
  case_manager: CLINICAL_CORE,
  bht_recovery_support: {
    census_summary: { read: 'OPERATIONAL' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  },
  admissions: CLINICAL_CORE,
  utilization_review: CLINICAL_CORE,
  revenue_cycle: {
    patient_summary: { read: 'PHI' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  },
  quality_risk: {
    patient_summary: { read: 'PHI' },
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
    audit_event: { read: 'PHI' },
  },
  hr_learning: {
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  },
  facilities_environmental_services: {
    work_item: { read: 'OPERATIONAL', write: 'OPERATIONAL' },
  },
  read_only_auditor: {
    audit_event: { read: 'PHI' },
    access_review: { read: 'PHI' },
    census_summary: { read: 'OPERATIONAL' },
  },
};

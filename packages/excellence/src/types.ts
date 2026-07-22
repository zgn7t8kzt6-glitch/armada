import type { BaselineRole } from '@armada/auth';

/**
 * Excellence System content models (blueprint §15).
 *
 * AES content is versioned, approved, and exportable to printable/offline
 * formats. It contains cultural and operational standards — never PHI.
 */

export const CONTENT_KINDS = [
  'gold_standard',
  'role_card',
  'policy',
  'constitution_document',
] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

/** Cultural constitution document types (blueprint §15.1). */
export const CONSTITUTION_DOC_TYPES = [
  'purpose',
  'mission',
  'vision',
  'credo',
  'patient_promise',
  'employee_promise',
  'leadership_promise',
  'service_values',
  'non_negotiable_behaviors',
] as const;

export type ConstitutionDocType = (typeof CONSTITUTION_DOC_TYPES)[number];

/** Gold Standard model (blueprint §15.2). */
export interface GoldStandardBody {
  readonly kind: 'gold_standard';
  readonly statement: string;
  readonly whyItMatters: string;
  readonly observableBehaviors: readonly string[];
  readonly unacceptableBehaviors: readonly string[];
  readonly roleExamples: readonly { readonly role: BaselineRole; readonly example: string }[];
  readonly patientExperienceConnection: string;
  readonly complianceConnection: string;
  readonly huddlePrompt: string;
  readonly recognitionExamples: readonly string[];
  readonly trainingModuleRef?: string;
}

/** Role card model (blueprint §15.4). */
export interface RoleCardBody {
  readonly kind: 'role_card';
  readonly role: BaselineRole;
  readonly rolePurpose: string;
  readonly patientPromise: string;
  readonly topResponsibilities: readonly string[];
  readonly shiftStart: readonly string[];
  readonly duringShift: readonly string[];
  readonly shiftEnd: readonly string[];
  readonly momentsOfTruth: readonly string[];
  readonly escalationTriggers: readonly string[];
  readonly documentationResponsibilities: readonly string[];
  readonly kpis: readonly string[];
  readonly competencies: readonly string[];
  readonly requiredPolicies: readonly string[];
  readonly goldStandardExamples: readonly string[];
  readonly careerPath: readonly string[];
}

export interface PolicyBody {
  readonly kind: 'policy';
  readonly purpose: string;
  readonly scope: string;
  readonly policyText: string;
  readonly procedureSteps: readonly string[];
  readonly references: readonly string[];
  readonly reviewFrequencyMonths: number;
  readonly responsibleRole: BaselineRole;
}

export interface ConstitutionBody {
  readonly kind: 'constitution_document';
  readonly docType: ConstitutionDocType;
  readonly text: string;
}

export type ContentBody = GoldStandardBody | RoleCardBody | PolicyBody | ConstitutionBody;

/**
 * Version lifecycle. Content becomes immutable at submission; publishing a
 * new version supersedes the previous published one. History is never lost.
 */
export const VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
] as const;

export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface Approval {
  readonly approverId: string;
  readonly approverRole: BaselineRole;
  readonly approvedAt: string;
  readonly note?: string;
}

export interface ContentVersion {
  readonly contentId: string;
  readonly version: number;
  readonly kind: ContentKind;
  readonly title: string;
  readonly body: ContentBody;
  readonly status: VersionStatus;
  readonly createdById: string;
  readonly createdAt: string;
  readonly submittedAt?: string;
  readonly approval?: Approval;
  readonly publishedAt?: string;
}

export interface ContentItem {
  readonly id: string;
  readonly kind: ContentKind;
  readonly versions: readonly ContentVersion[];
}

/** Roles that may approve content for publication (blueprint §3.2 spirit:
 * leadership/governance sign-off; approver must differ from author). */
export const APPROVER_ROLES: readonly BaselineRole[] = [
  'executive',
  'clinical_director',
  'nursing_director',
  'compliance_administrator',
  'quality_risk',
];

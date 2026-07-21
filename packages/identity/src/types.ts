import type { SourceSystem } from '@armada/integrations-core';

/**
 * Identity resolution types (blueprint §9).
 *
 * PHI note: identity signals (names, DOBs, contact details) are the most
 * sensitive operational data the platform holds. They live only inside the
 * identity store, are served only through the policy-gated reconciliation
 * console, and never appear in audit events or logs — audit records carry
 * internal IDs and field NAMES, not values. All development data is
 * synthetic (CLAUDE.md #6).
 */

/** Match attributes (§9.1). All optional — sources vary in completeness. */
export interface IdentitySignals {
  readonly mrn?: string;
  /** Facility that issued the MRN; MRN equality only counts within it. */
  readonly mrnFacilityId?: string;
  readonly legalName?: string;
  readonly dateOfBirth?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly addressLine?: string;
  readonly payerMemberId?: string;
}

export type SignalField = keyof IdentitySignals;

export interface PersonRecord {
  readonly id: string;
  readonly signals: IdentitySignals;
  readonly createdAt: string;
  readonly createdBy: string;
  /** Set when this person was merged into another (soft, reversible). */
  readonly mergedInto?: string;
}

export interface CrosswalkEntry {
  readonly personId: string;
  readonly sourceSystem: SourceSystem;
  readonly sourceRecordId: string;
  readonly linkedAt: string;
  /** `rule:<id>` for deterministic links, user id for human decisions. */
  readonly linkedBy: string;
  readonly method: 'existing_crosswalk' | 'deterministic' | 'human_review';
}

export interface IncomingIdentity {
  readonly sourceSystem: SourceSystem;
  readonly sourceRecordId: string;
  readonly signals: IdentitySignals;
}

export interface CandidateMatch {
  readonly personId: string;
  readonly matchedFields: readonly SignalField[];
  /** Hard conflicts (MRN within facility, DOB) that forbid auto-linking. */
  readonly conflictingFields: readonly SignalField[];
  /** Fields present on both sides with different values (context for review). */
  readonly differingFields: readonly SignalField[];
}

export type ResolutionOutcome =
  | 'auto_linked_existing_crosswalk'
  | 'auto_linked_deterministic'
  | 'created_new_person'
  | 'queued_for_review';

export type ReviewReason = 'multiple_candidates' | 'low_confidence' | 'conflicting_identifiers';

export interface ResolutionExplanation {
  readonly ruleId?: string;
  readonly reviewReason?: ReviewReason;
  readonly candidates: readonly CandidateMatch[];
}

export interface ResolutionResult {
  readonly outcome: ResolutionOutcome;
  readonly personId?: string;
  readonly issueId?: string;
  readonly explanation: ResolutionExplanation;
}

export const ISSUE_ACTIONS = ['link', 'create_new', 'defer', 'escalate'] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

export type IssueStatus = 'open' | 'deferred' | 'escalated' | 'resolved';

export interface IssueResolution {
  readonly action: IssueAction;
  readonly personId?: string;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
  readonly note?: string;
}

export interface ReconciliationIssue {
  readonly id: string;
  readonly status: IssueStatus;
  readonly reason: ReviewReason;
  readonly incoming: IncomingIdentity;
  readonly candidates: readonly CandidateMatch[];
  readonly createdAt: string;
  readonly history: readonly IssueResolution[];
  readonly resolution?: IssueResolution;
}

export type MergeStatus = 'pending' | 'executed' | 'unmerged' | 'rejected';

export interface MergeRecord {
  readonly id: string;
  readonly primaryPersonId: string;
  readonly duplicatePersonId: string;
  readonly reason: string;
  readonly status: MergeStatus;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly confirmedBy?: string;
  readonly confirmedAt?: string;
  /** Crosswalk source refs moved during execution — needed for unmerge. */
  readonly movedCrosswalks: readonly { sourceSystem: SourceSystem; sourceRecordId: string }[];
  readonly unmergedBy?: string;
  readonly unmergedAt?: string;
  readonly unmergeReason?: string;
}

export {
  ISSUE_ACTIONS,
  type CandidateMatch,
  type CrosswalkEntry,
  type IdentitySignals,
  type IncomingIdentity,
  type IssueAction,
  type IssueResolution,
  type IssueStatus,
  type MergeRecord,
  type MergeStatus,
  type PersonRecord,
  type ReconciliationIssue,
  type ResolutionExplanation,
  type ResolutionOutcome,
  type ResolutionResult,
  type ReviewReason,
  type SignalField,
} from './types.js';
export {
  CORROBORATING_FIELDS,
  compareSignals,
  evaluateAutoLink,
  findCandidates,
  normalizeSignals,
  type AutoLinkDecision,
} from './matching.js';
export { IdentityService, type IdentityServiceOptions } from './service.js';
export { seedIdentityScenarios, type IdentitySeedSummary } from './seed.js';

export {
  BASELINE_ROLES,
  RESOURCE_TYPES,
  ROLE_CAPABILITY_MATRIX,
  isBaselineRole,
  type AccessAction,
  type BaselineRole,
  type Capability,
  type ClassificationCeiling,
  type ResourceType,
  type RoleCapabilities,
} from './roles.js';
export {
  CLASSIFICATION_RANK,
  DATA_CLASSIFICATIONS,
  PURPOSES_OF_USE,
  type AccessDecision,
  type AccessReasonCode,
  type AccessRequest,
  type BreakGlassActivation,
  type DataClassification,
  type Principal,
  type PurposeOfUse,
  type ResourceRef,
  type RoleAssignment,
  type UserRecord,
  type UserStatus,
} from './types.js';
export { POLICY_VERSION, evaluateAccess, type PolicyOptions } from './policy.js';
export { InMemoryUserStore, type NewUser, type UserStore } from './users.js';
export {
  SessionManager,
  type SessionManagerOptions,
  type SessionRecord,
  type SessionVerification,
} from './sessions.js';
export {
  DEV_ISSUER,
  DevIdentityProvider,
  type DevCredential,
  type DevIdentityProviderOptions,
  type IdentityProvider,
} from './idp.js';
export {
  BreakGlassService,
  type ActivateBreakGlassInput,
  type BreakGlassServiceOptions,
} from './breakGlass.js';
export {
  generateAccessReviewReport,
  type AccessReviewInput,
  type AccessReviewReport,
  type AssignmentRow,
} from './accessReview.js';

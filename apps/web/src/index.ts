/**
 * apps/web — role-based user experience (stub).
 *
 * The frontend framework decision (blueprint §5.1 recommends Next.js/React/
 * Tailwind) is deferred until the dependency policy in ADR-0003 is revisited
 * at the start of Epic 10 (role workspaces). Until then this workspace only
 * reserves the deployable unit and its navigation contract.
 */

/** Top-level navigation defined by blueprint §20. */
export const NAVIGATION = [
  'Home',
  'My Work',
  'Patients/Episodes',
  'Admissions',
  'Census/Beds',
  'UR',
  'Revenue Cycle',
  'Quality/Compliance',
  'Excellence Library',
  'Learning',
  'Reports',
  'Administration',
] as const;

export type NavigationItem = (typeof NAVIGATION)[number];

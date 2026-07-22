/**
 * apps/admin — restricted configuration and governance UI (stub).
 *
 * Reserved deployable unit. Admin surfaces require elevated permissions and
 * reauthentication for sensitive actions (blueprint §21); nothing ships here
 * until the authorization model of Epic 2 exists to enforce that.
 */

/** Governance areas the admin app will expose (blueprint §3, §27). */
export const ADMIN_AREAS = [
  'Facilities & Units',
  'Roles & Access Policies',
  'Feature Flags',
  'Metric Definitions',
  'Rule Definitions',
  'Integration Monitoring',
  'Audit Events',
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number];

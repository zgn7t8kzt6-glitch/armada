import type { BaselineRole } from '@armada/auth';

/**
 * Work item and escalation system (blueprint §18).
 *
 * PHI rule: work items carry stable internal references only. Titles,
 * explanations, and source facts must use subject IDs and operational
 * language ("Authorization for episode ep-1042 expires in 48h"), never
 * names, DOBs, or clinical content. The deep link takes the user to the
 * authoritative system, behind that system's own authentication.
 */

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const WORK_ITEM_STATUSES = ['open', 'acknowledged', 'resolved', 'cancelled'] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Closed set of resolution codes (blueprint §18); reporting depends on it. */
export const RESOLUTION_CODES = [
  'completed',
  'completed_with_exception',
  'not_applicable',
  'duplicate',
  'transferred_to_source_system',
  'unable_to_complete',
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

/** Codes whose selection demands a human-readable justification. */
export const CODES_REQUIRING_NOTE: readonly ResolutionCode[] = [
  'completed_with_exception',
  'unable_to_complete',
];

/** Every displayed fact retains its source and source timestamp (§2.7, CLAUDE.md #9). */
export interface SourceFact {
  readonly label: string;
  readonly value: string;
  readonly sourceSystem: string;
  readonly sourceTimestamp: string;
}

export interface SourceLink {
  readonly label: string;
  /** Path/URL into the authoritative system; that system enforces its own auth. */
  readonly href: string;
}

export interface EscalationEvent {
  readonly at: string;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly notifiedRole: BaselineRole;
  readonly reason: 'overdue' | 'manual';
  readonly byUserId?: string;
  readonly note?: string;
}

export interface Resolution {
  readonly code: ResolutionCode;
  readonly note?: string;
}

export interface WorkItem {
  readonly id: string;
  /** Dotted type, e.g. `ur.authorization_expiring`. */
  readonly type: string;
  readonly title: string;
  /** Why this work item exists — required for every alert (CLAUDE.md #9). */
  readonly explanation: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly priority: Priority;
  readonly createdAt: string;
  readonly dueAt: string;
  /** Escalation targets a role, not only a person (§18). */
  readonly ownerRole: BaselineRole;
  readonly ownerUserId?: string;
  readonly backupRole?: BaselineRole;
  readonly sourceFacts: readonly SourceFact[];
  readonly sourceLinks: readonly SourceLink[];
  /** Applicable Gold Standard / rule reference. */
  readonly standardRef?: string;
  readonly requiredAction: string;
  readonly status: WorkItemStatus;
  readonly acknowledgedAt?: string;
  readonly acknowledgedBy?: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolution?: Resolution;
  readonly cancelledReason?: string;
  readonly escalationLevel: number;
  readonly escalations: readonly EscalationEvent[];
  /** Optimistic-locking counter; increments on every mutation (§8). */
  readonly version: number;
}

/**
 * Notification abstraction (§18). Deliberately PHI-free by construction:
 * the payload carries type/priority/due/link — never the item title,
 * explanation, or facts. Channels beyond in-app (email/SMS via approved
 * providers) plug in behind the same interface later.
 */
export interface WorkNotification {
  readonly id: string;
  readonly at: string;
  readonly channel: 'in_app';
  readonly recipientRole: BaselineRole;
  readonly recipientUserId?: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly workItemId: string;
  readonly workItemType: string;
  readonly priority: Priority;
  readonly dueAt: string;
  readonly escalationLevel: number;
  /** In-app path; the app authenticates before rendering anything. */
  readonly linkPath: string;
}

export interface Notifier {
  notify(input: Omit<WorkNotification, 'id' | 'at' | 'channel'>): WorkNotification;
}

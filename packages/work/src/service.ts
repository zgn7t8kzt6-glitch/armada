import type { AuditLog } from '@armada/audit';
import { isBaselineRole, type BaselineRole } from '@armada/auth';
import {
  CODES_REQUIRING_NOTE,
  PRIORITIES,
  PRIORITY_RANK,
  RESOLUTION_CODES,
  type Notifier,
  type Priority,
  type ResolutionCode,
  type SourceFact,
  type SourceLink,
  type WorkItem,
  type WorkItemStatus,
} from './types.js';

/**
 * Work-item engine: creation with mandatory explanation/provenance/owner
 * (CLAUDE.md #9), role-owned queues, acknowledgment, resolution codes,
 * cancellation, and a time-based escalation ladder that notifies roles.
 *
 * Escalation ladder (overdue items):
 *   level 1 at due time      → re-notify the owner role
 *   level 2 after N hours    → notify the backup role (or facility_administrator)
 *   level 3 after M hours    → notify the executive role
 * Critical safety issues must additionally use existing emergency channels —
 * this system is a work tracker, not an emergency notification system (§18).
 */

const TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export interface EscalationPolicy {
  readonly toLevel2AfterHours: number;
  readonly toLevel3AfterHours: number;
}

export interface WorkItemServiceOptions {
  readonly audit: AuditLog;
  readonly notifier: Notifier;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly escalationPolicy?: EscalationPolicy;
}

export interface CreateWorkItemInput {
  readonly type: string;
  readonly title: string;
  readonly explanation: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly priority: Priority;
  readonly dueAt: string;
  readonly ownerRole: BaselineRole;
  readonly backupRole?: BaselineRole;
  readonly sourceFacts: readonly SourceFact[];
  readonly sourceLinks?: readonly SourceLink[];
  readonly standardRef?: string;
  readonly requiredAction: string;
  readonly createdBy: string;
}

export interface QueueFilter {
  readonly facilityId?: string;
  readonly status?: WorkItemStatus;
  readonly ownerRole?: BaselineRole;
  readonly ownerUserId?: string;
  readonly type?: string;
  readonly overdueOnly?: boolean;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} must not be empty`);
}

export class WorkItemService {
  readonly #items = new Map<string, WorkItem>();
  readonly #audit: AuditLog;
  readonly #notifier: Notifier;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #policy: EscalationPolicy;

  constructor(options: WorkItemServiceOptions) {
    this.#audit = options.audit;
    this.#notifier = options.notifier;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#policy = options.escalationPolicy ?? { toLevel2AfterHours: 4, toLevel3AfterHours: 12 };
  }

  create(input: CreateWorkItemInput): WorkItem {
    if (!TYPE_PATTERN.test(input.type)) {
      throw new Error(`Work item type must be dotted lowercase (got "${input.type}")`);
    }
    requireNonEmpty(input.title, 'title');
    // CLAUDE.md #9: every alert requires an explanation, source timestamp,
    // owner, and resolution method.
    requireNonEmpty(input.explanation, 'explanation');
    requireNonEmpty(input.requiredAction, 'requiredAction');
    requireNonEmpty(input.subjectType, 'subjectType');
    requireNonEmpty(input.subjectId, 'subjectId');
    if (!PRIORITIES.includes(input.priority)) {
      throw new Error(`Unknown priority: ${String(input.priority)}`);
    }
    if (!isBaselineRole(input.ownerRole)) {
      throw new Error(`Unknown owner role: ${String(input.ownerRole)}`);
    }
    if (input.backupRole !== undefined && !isBaselineRole(input.backupRole)) {
      throw new Error(`Unknown backup role: ${String(input.backupRole)}`);
    }
    if (input.sourceFacts.length === 0) {
      throw new Error('At least one source fact with a source timestamp is required');
    }
    for (const fact of input.sourceFacts) {
      requireNonEmpty(fact.label, 'sourceFact label');
      requireNonEmpty(fact.sourceSystem, 'sourceFact sourceSystem');
      if (Number.isNaN(Date.parse(fact.sourceTimestamp))) {
        throw new Error(`sourceFact "${fact.label}" has an invalid sourceTimestamp`);
      }
    }
    if (Number.isNaN(Date.parse(input.dueAt))) {
      throw new Error('dueAt must be a valid timestamp');
    }

    const now = this.#now().toISOString();
    const item: WorkItem = Object.freeze({
      id: this.#newId(),
      type: input.type,
      title: input.title,
      explanation: input.explanation,
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      priority: input.priority,
      createdAt: now,
      dueAt: input.dueAt,
      ownerRole: input.ownerRole,
      sourceFacts: Object.freeze([...input.sourceFacts]),
      sourceLinks: Object.freeze([...(input.sourceLinks ?? [])]),
      requiredAction: input.requiredAction,
      status: 'open' as const,
      escalationLevel: 0,
      escalations: Object.freeze([]),
      version: 1,
      ...(input.backupRole !== undefined ? { backupRole: input.backupRole } : {}),
      ...(input.standardRef !== undefined ? { standardRef: input.standardRef } : {}),
    });
    this.#items.set(item.id, item);
    this.#audit.append({
      actorType: 'user',
      actorId: input.createdBy,
      action: 'work_item.created',
      subjectType: 'work_item',
      subjectId: item.id,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      summary: `type=${item.type} priority=${item.priority} owner_role=${item.ownerRole}`,
    });
    this.#notifyRole(item, item.ownerRole);
    return item;
  }

  get(id: string): WorkItem | undefined {
    return this.#items.get(id);
  }

  listQueue(filter: QueueFilter = {}): readonly WorkItem[] {
    const now = this.#now().getTime();
    return [...this.#items.values()]
      .filter((item) => {
        if (filter.facilityId !== undefined && item.facilityId !== filter.facilityId) return false;
        if (filter.status !== undefined && item.status !== filter.status) return false;
        if (filter.ownerRole !== undefined && item.ownerRole !== filter.ownerRole) return false;
        if (filter.ownerUserId !== undefined && item.ownerUserId !== filter.ownerUserId) return false;
        if (filter.type !== undefined && item.type !== filter.type) return false;
        if (filter.overdueOnly === true) {
          if (item.status !== 'open' && item.status !== 'acknowledged') return false;
          if (Date.parse(item.dueAt) > now) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          Date.parse(a.dueAt) - Date.parse(b.dueAt),
      );
  }

  acknowledge(id: string, input: { userId: string; expectedVersion?: number }): WorkItem {
    const item = this.#requireActive(id, input.expectedVersion);
    if (item.status !== 'open') {
      throw new Error(`Only open items can be acknowledged (status: ${item.status})`);
    }
    const updated: WorkItem = Object.freeze({
      ...item,
      status: 'acknowledged' as const,
      acknowledgedAt: this.#now().toISOString(),
      acknowledgedBy: input.userId,
      // Acknowledging claims ownership if nobody holds it yet.
      ownerUserId: item.ownerUserId ?? input.userId,
      version: item.version + 1,
    });
    this.#items.set(id, updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'work_item.acknowledged',
      subjectType: 'work_item',
      subjectId: id,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
    });
    return updated;
  }

  resolve(
    id: string,
    input: { userId: string; code: ResolutionCode; note?: string; expectedVersion?: number },
  ): WorkItem {
    const item = this.#requireActive(id, input.expectedVersion);
    if (!RESOLUTION_CODES.includes(input.code)) {
      throw new Error(`Unknown resolution code: ${String(input.code)}`);
    }
    if (CODES_REQUIRING_NOTE.includes(input.code) && (input.note ?? '').trim().length < 5) {
      throw new Error(`Resolution code ${input.code} requires an explanatory note`);
    }
    const updated: WorkItem = Object.freeze({
      ...item,
      status: 'resolved' as const,
      resolvedAt: this.#now().toISOString(),
      resolvedBy: input.userId,
      resolution: {
        code: input.code,
        ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note.trim() } : {}),
      },
      version: item.version + 1,
    });
    this.#items.set(id, updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'work_item.resolved',
      subjectType: 'work_item',
      subjectId: id,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      summary: `code=${input.code}`,
    });
    return updated;
  }

  cancel(id: string, input: { userId: string; reason: string; expectedVersion?: number }): WorkItem {
    const item = this.#requireActive(id, input.expectedVersion);
    requireNonEmpty(input.reason, 'reason');
    const updated: WorkItem = Object.freeze({
      ...item,
      status: 'cancelled' as const,
      cancelledReason: input.reason.trim(),
      version: item.version + 1,
    });
    this.#items.set(id, updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'work_item.cancelled',
      subjectType: 'work_item',
      subjectId: id,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      summary: `reason=${input.reason.trim()}`,
    });
    return updated;
  }

  escalate(id: string, input: { byUserId: string; note?: string }): WorkItem {
    const item = this.#requireActive(id);
    return this.#escalateTo(item, item.escalationLevel + 1, 'manual', input.byUserId, input.note);
  }

  /**
   * Time-based escalation sweep; call periodically (worker/scheduler).
   * Idempotent: an item only escalates when its computed target level
   * exceeds its current level.
   */
  sweepEscalations(): readonly WorkItem[] {
    const now = this.#now().getTime();
    const escalated: WorkItem[] = [];
    for (const item of this.#items.values()) {
      if (item.status !== 'open' && item.status !== 'acknowledged') continue;
      const overdueMs = now - Date.parse(item.dueAt);
      if (overdueMs < 0) continue;
      const overdueHours = overdueMs / 3_600_000;
      let target = 1;
      if (overdueHours >= this.#policy.toLevel3AfterHours) target = 3;
      else if (overdueHours >= this.#policy.toLevel2AfterHours) target = 2;
      if (target > item.escalationLevel) {
        escalated.push(this.#escalateTo(item, target, 'overdue'));
      }
    }
    return escalated;
  }

  #escalateTo(
    item: WorkItem,
    toLevel: number,
    reason: 'overdue' | 'manual',
    byUserId?: string,
    note?: string,
  ): WorkItem {
    if (toLevel > 3) {
      throw new Error('Escalation level is capped at 3 (executive)');
    }
    const notifiedRole: BaselineRole =
      toLevel === 1
        ? item.ownerRole
        : toLevel === 2
          ? (item.backupRole ?? 'facility_administrator')
          : 'executive';
    const updated: WorkItem = Object.freeze({
      ...item,
      escalationLevel: toLevel,
      escalations: Object.freeze([
        ...item.escalations,
        {
          at: this.#now().toISOString(),
          fromLevel: item.escalationLevel,
          toLevel,
          notifiedRole,
          reason,
          ...(byUserId !== undefined ? { byUserId } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      ]),
      version: item.version + 1,
    });
    this.#items.set(item.id, updated);
    this.#audit.append({
      actorType: byUserId !== undefined ? 'user' : 'service',
      actorId: byUserId ?? 'work-escalation-sweep',
      action: 'work_item.escalated',
      subjectType: 'work_item',
      subjectId: item.id,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      summary: `to_level=${toLevel} notified_role=${notifiedRole} reason=${reason}`,
    });
    this.#notifyRole(updated, notifiedRole);
    return updated;
  }

  #notifyRole(item: WorkItem, role: BaselineRole): void {
    // PHI-safe by construction: type/priority/due/link only — no title,
    // explanation, or facts (§18: no PHI in notifications).
    this.#notifier.notify({
      recipientRole: role,
      organizationId: item.organizationId,
      facilityId: item.facilityId,
      workItemId: item.id,
      workItemType: item.type,
      priority: item.priority,
      dueAt: item.dueAt,
      escalationLevel: item.escalationLevel,
      linkPath: `/my-work/${item.id}`,
      ...(item.ownerUserId !== undefined ? { recipientUserId: item.ownerUserId } : {}),
    });
  }

  #requireActive(id: string, expectedVersion?: number): WorkItem {
    const item = this.#items.get(id);
    if (item === undefined) throw new Error(`Unknown work item: ${id}`);
    if (item.status === 'resolved' || item.status === 'cancelled') {
      throw new Error(`Work item is ${item.status} and can no longer change`);
    }
    if (expectedVersion !== undefined && item.version !== expectedVersion) {
      throw new Error(
        `Version conflict: expected ${expectedVersion}, current ${item.version} — reload and retry`,
      );
    }
    return item;
  }
}

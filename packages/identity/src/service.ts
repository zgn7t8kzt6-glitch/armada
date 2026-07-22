import type { AuditLog } from '@armada/audit';
import type { SourceSystem } from '@armada/integrations-core';
import { evaluateAutoLink, findCandidates, normalizeSignals } from './matching.js';
import {
  ISSUE_ACTIONS,
  type CrosswalkEntry,
  type IdentitySignals,
  type IncomingIdentity,
  type IssueAction,
  type IssueStatus,
  type MergeRecord,
  type PersonRecord,
  type ReconciliationIssue,
  type ResolutionResult,
  type ReviewReason,
} from './types.js';

/**
 * Identity resolution service (blueprint §9).
 *
 * Invariants enforced here, not in callers:
 *  - only deterministic rules auto-link; every ambiguity queues for humans;
 *  - conflicting MRN/DOB never auto-links;
 *  - merges require dual confirmation (requester ≠ confirmer);
 *  - unmerge is supported and fully audited;
 *  - audit events carry internal IDs, rule IDs, and field NAMES — never
 *    signal values.
 */

export interface IdentityServiceOptions {
  readonly audit: AuditLog;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function crosswalkKey(sourceSystem: string, sourceRecordId: string): string {
  return `${sourceSystem}:${sourceRecordId}`;
}

export class IdentityService {
  readonly #persons = new Map<string, PersonRecord>();
  readonly #crosswalks = new Map<string, CrosswalkEntry>();
  readonly #issues = new Map<string, ReconciliationIssue>();
  readonly #merges = new Map<string, MergeRecord>();
  readonly #audit: AuditLog;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: IdentityServiceOptions) {
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Create a person directly (seeding, or the review console's create-new). */
  registerPerson(signals: IdentitySignals, createdBy: string): PersonRecord {
    const person: PersonRecord = Object.freeze({
      id: this.#newId(),
      signals: normalizeSignals(signals),
      createdAt: this.#now().toISOString(),
      createdBy,
    });
    this.#persons.set(person.id, person);
    this.#audit.append({
      actorType: createdBy.startsWith('rule:') ? 'service' : 'user',
      actorId: createdBy,
      action: 'identity.person_created',
      subjectType: 'person',
      subjectId: person.id,
      summary: `signals=${Object.keys(person.signals).join(',')}`,
    });
    return person;
  }

  /** Resolve an incoming source identity per §9.2. */
  resolve(incoming: IncomingIdentity): ResolutionResult {
    const existing = this.#crosswalks.get(
      crosswalkKey(incoming.sourceSystem, incoming.sourceRecordId),
    );
    if (existing !== undefined) {
      return {
        outcome: 'auto_linked_existing_crosswalk',
        personId: this.#canonicalPersonId(existing.personId),
        explanation: { ruleId: 'R0_EXISTING_CROSSWALK', candidates: [] },
      };
    }

    const candidates = findCandidates(incoming.signals, this.#persons.values());
    const decision = evaluateAutoLink(candidates);
    if (decision !== undefined) {
      this.#link(incoming, decision.personId, `rule:${decision.ruleId}`, 'deterministic');
      return {
        outcome: 'auto_linked_deterministic',
        personId: decision.personId,
        explanation: { ruleId: decision.ruleId, candidates },
      };
    }

    if (candidates.length > 0) {
      const reason: ReviewReason = candidates.some((c) => c.conflictingFields.length > 0)
        ? 'conflicting_identifiers'
        : candidates.length > 1
          ? 'multiple_candidates'
          : 'low_confidence';
      const issue: ReconciliationIssue = Object.freeze({
        id: this.#newId(),
        status: 'open' as IssueStatus,
        reason,
        incoming: {
          sourceSystem: incoming.sourceSystem,
          sourceRecordId: incoming.sourceRecordId,
          signals: normalizeSignals(incoming.signals),
        },
        candidates,
        createdAt: this.#now().toISOString(),
        history: Object.freeze([]),
      });
      this.#issues.set(issue.id, issue);
      this.#audit.append({
        actorType: 'service',
        actorId: 'identity-resolution',
        action: 'identity.review_queued',
        subjectType: 'reconciliation_issue',
        subjectId: issue.id,
        summary: `reason=${reason} candidates=${candidates.length}`,
      });
      return { outcome: 'queued_for_review', issueId: issue.id, explanation: { reviewReason: reason, candidates } };
    }

    const person = this.registerPerson(incoming.signals, 'rule:R3_NO_CANDIDATES');
    this.#link(incoming, person.id, 'rule:R3_NO_CANDIDATES', 'deterministic');
    return {
      outcome: 'created_new_person',
      personId: person.id,
      explanation: { ruleId: 'R3_NO_CANDIDATES', candidates: [] },
    };
  }

  resolveIssue(
    issueId: string,
    input: { action: IssueAction; userId: string; personId?: string; note?: string },
  ): ReconciliationIssue {
    const issue = this.#issues.get(issueId);
    if (issue === undefined) throw new Error(`Unknown issue: ${issueId}`);
    if (issue.status === 'resolved') throw new Error('Issue is already resolved');
    if (!ISSUE_ACTIONS.includes(input.action)) {
      throw new Error(`Unknown action: ${String(input.action)}`);
    }

    let personId: string | undefined;
    let status: IssueStatus;
    switch (input.action) {
      case 'link': {
        if (input.personId === undefined) throw new Error('link requires a personId');
        const person = this.#persons.get(input.personId);
        if (person === undefined || person.mergedInto !== undefined) {
          throw new Error('link target must be an active person');
        }
        if (!issue.candidates.some((c) => c.personId === input.personId)) {
          throw new Error('link target must be one of the issue candidates');
        }
        this.#link(issue.incoming, input.personId, input.userId, 'human_review');
        personId = input.personId;
        status = 'resolved';
        break;
      }
      case 'create_new': {
        const person = this.registerPerson(issue.incoming.signals, input.userId);
        this.#link(issue.incoming, person.id, input.userId, 'human_review');
        personId = person.id;
        status = 'resolved';
        break;
      }
      case 'defer':
        status = 'deferred';
        break;
      case 'escalate':
        status = 'escalated';
        break;
    }

    const resolution = Object.freeze({
      action: input.action,
      resolvedBy: input.userId,
      resolvedAt: this.#now().toISOString(),
      ...(personId !== undefined ? { personId } : {}),
      ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note.trim() } : {}),
    });
    const updated: ReconciliationIssue = Object.freeze({
      ...issue,
      status,
      history: Object.freeze([...issue.history, resolution]),
      ...(status === 'resolved' ? { resolution } : {}),
    });
    this.#issues.set(issueId, updated);
    this.#audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'identity.review_resolved',
      subjectType: 'reconciliation_issue',
      subjectId: issueId,
      summary: `action=${input.action}${personId !== undefined ? ` person=${personId}` : ''}`,
    });
    return updated;
  }

  /** Merge step 1: request. High-risk by definition → always dual-confirmed. */
  requestMerge(input: {
    primaryPersonId: string;
    duplicatePersonId: string;
    reason: string;
    requestedBy: string;
  }): MergeRecord {
    if (input.primaryPersonId === input.duplicatePersonId) {
      throw new Error('Cannot merge a person into themselves');
    }
    if (input.reason.trim().length < 10) {
      throw new Error('Merge requires an explicit reason (>= 10 chars)');
    }
    for (const id of [input.primaryPersonId, input.duplicatePersonId]) {
      const person = this.#persons.get(id);
      if (person === undefined || person.mergedInto !== undefined) {
        throw new Error(`Person is not active: ${id}`);
      }
    }
    const merge: MergeRecord = Object.freeze({
      id: this.#newId(),
      primaryPersonId: input.primaryPersonId,
      duplicatePersonId: input.duplicatePersonId,
      reason: input.reason.trim(),
      status: 'pending' as const,
      requestedBy: input.requestedBy,
      requestedAt: this.#now().toISOString(),
      movedCrosswalks: Object.freeze([]),
    });
    this.#merges.set(merge.id, merge);
    this.#audit.append({
      actorType: 'user',
      actorId: input.requestedBy,
      action: 'identity.merge_requested',
      subjectType: 'person_merge',
      subjectId: merge.id,
      summary: `primary=${merge.primaryPersonId} duplicate=${merge.duplicatePersonId}`,
    });
    return merge;
  }

  /** Merge step 2: a DIFFERENT user confirms; crosswalks move to primary. */
  confirmMerge(mergeId: string, confirmedBy: string): MergeRecord {
    const merge = this.#merges.get(mergeId);
    if (merge === undefined) throw new Error(`Unknown merge: ${mergeId}`);
    if (merge.status !== 'pending') throw new Error(`Merge is ${merge.status}`);
    if (confirmedBy === merge.requestedBy) {
      throw new Error('Merge confirmation requires a second reviewer (dual confirmation)');
    }
    const duplicate = this.#persons.get(merge.duplicatePersonId);
    const primary = this.#persons.get(merge.primaryPersonId);
    if (duplicate === undefined || primary === undefined || primary.mergedInto !== undefined) {
      throw new Error('Merge participants are no longer active');
    }

    const moved: { sourceSystem: SourceSystem; sourceRecordId: string }[] = [];
    for (const [key, entry] of this.#crosswalks) {
      if (entry.personId === merge.duplicatePersonId) {
        this.#crosswalks.set(key, Object.freeze({ ...entry, personId: merge.primaryPersonId }));
        moved.push({ sourceSystem: entry.sourceSystem, sourceRecordId: entry.sourceRecordId });
      }
    }
    this.#persons.set(
      duplicate.id,
      Object.freeze({ ...duplicate, mergedInto: merge.primaryPersonId }),
    );
    const executed: MergeRecord = Object.freeze({
      ...merge,
      status: 'executed' as const,
      confirmedBy,
      confirmedAt: this.#now().toISOString(),
      movedCrosswalks: Object.freeze(moved),
    });
    this.#merges.set(mergeId, executed);
    this.#audit.append({
      actorType: 'user',
      actorId: confirmedBy,
      action: 'identity.merge_confirmed',
      subjectType: 'person_merge',
      subjectId: mergeId,
      summary: `moved_crosswalks=${moved.length}`,
    });
    return executed;
  }

  /** Unmerge (§9.2): restore the duplicate and its crosswalks, fully audited. */
  unmerge(mergeId: string, input: { userId: string; reason: string }): MergeRecord {
    const merge = this.#merges.get(mergeId);
    if (merge === undefined) throw new Error(`Unknown merge: ${mergeId}`);
    if (merge.status !== 'executed') throw new Error(`Only executed merges can be unmerged`);
    if (input.reason.trim().length < 10) {
      throw new Error('Unmerge requires an explicit reason (>= 10 chars)');
    }
    const duplicate = this.#persons.get(merge.duplicatePersonId);
    if (duplicate === undefined) throw new Error('Duplicate person record missing');

    for (const ref of merge.movedCrosswalks) {
      const key = crosswalkKey(ref.sourceSystem, ref.sourceRecordId);
      const entry = this.#crosswalks.get(key);
      if (entry !== undefined && entry.personId === merge.primaryPersonId) {
        this.#crosswalks.set(key, Object.freeze({ ...entry, personId: merge.duplicatePersonId }));
      }
    }
    const { mergedInto: _mergedInto, ...restored } = duplicate;
    this.#persons.set(duplicate.id, Object.freeze(restored));
    const unmerged: MergeRecord = Object.freeze({
      ...merge,
      status: 'unmerged' as const,
      unmergedBy: input.userId,
      unmergedAt: this.#now().toISOString(),
      unmergeReason: input.reason.trim(),
    });
    this.#merges.set(mergeId, unmerged);
    this.#audit.append({
      actorType: 'user',
      actorId: input.userId,
      action: 'identity.unmerged',
      subjectType: 'person_merge',
      subjectId: mergeId,
      summary: `restored_crosswalks=${merge.movedCrosswalks.length}`,
    });
    return unmerged;
  }

  issues(filter: { status?: IssueStatus } = {}): readonly ReconciliationIssue[] {
    return [...this.#issues.values()]
      .filter((i) => filter.status === undefined || i.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getIssue(id: string): ReconciliationIssue | undefined {
    return this.#issues.get(id);
  }

  personById(id: string): PersonRecord | undefined {
    return this.#persons.get(id);
  }

  persons(): readonly PersonRecord[] {
    return [...this.#persons.values()];
  }

  crosswalksFor(personId: string): readonly CrosswalkEntry[] {
    return [...this.#crosswalks.values()].filter((c) => c.personId === personId);
  }

  merges(filter: { status?: MergeRecord['status'] } = {}): readonly MergeRecord[] {
    return [...this.#merges.values()].filter(
      (m) => filter.status === undefined || m.status === filter.status,
    );
  }

  getMerge(id: string): MergeRecord | undefined {
    return this.#merges.get(id);
  }

  #canonicalPersonId(personId: string): string {
    let current = this.#persons.get(personId);
    const seen = new Set<string>();
    while (current?.mergedInto !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.#persons.get(current.mergedInto);
    }
    return current?.id ?? personId;
  }

  #link(
    incoming: { sourceSystem: SourceSystem; sourceRecordId: string },
    personId: string,
    linkedBy: string,
    method: CrosswalkEntry['method'],
  ): void {
    const entry: CrosswalkEntry = Object.freeze({
      personId,
      sourceSystem: incoming.sourceSystem,
      sourceRecordId: incoming.sourceRecordId,
      linkedAt: this.#now().toISOString(),
      linkedBy,
      method,
    });
    this.#crosswalks.set(crosswalkKey(incoming.sourceSystem, incoming.sourceRecordId), entry);
    this.#audit.append({
      actorType: linkedBy.startsWith('rule:') ? 'service' : 'user',
      actorId: linkedBy,
      action: 'identity.linked',
      subjectType: 'person',
      subjectId: personId,
      summary: `source=${incoming.sourceSystem} method=${method}`,
    });
  }
}

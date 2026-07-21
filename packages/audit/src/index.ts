/**
 * Immutable audit event library (blueprint §22, ADR-0007).
 *
 * Append-only: the store exposes no update or delete operation, returned
 * events are frozen, and every event carries a SHA-256 hash chained to its
 * predecessor so any later tampering breaks `verifyIntegrity()`.
 *
 * Contents are internal references only — actor IDs, subject types/IDs,
 * request IDs, decision codes. Never PHI, never payloads (CLAUDE.md #5).
 * Durable storage with the same contract arrives with the database epic;
 * the in-memory implementation backs development and tests.
 */

import { createHash } from 'node:crypto';

export interface AuditEventInput {
  readonly actorType: 'user' | 'service';
  /** Internal user/service ID — never a name or email. */
  readonly actorId: string;
  /** Dotted verb, e.g. `session.created`, `break_glass.activated`. */
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly organizationId?: string;
  readonly facilityId?: string;
  readonly purpose?: string;
  readonly requestId?: string;
  /** ALLOW / DENY plus reason codes, when the action was policy-checked. */
  readonly policyDecision?: string;
  readonly breakGlassReason?: string;
  /** Safe change summary — internal references only, never PHI. */
  readonly summary?: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly id: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly previousHash: string;
  readonly hash: string;
}

export interface AuditQuery {
  readonly actorId?: string;
  readonly action?: string;
  /** Prefix match, e.g. `break_glass.` matches activate + expire. */
  readonly actionPrefix?: string;
  readonly facilityId?: string;
  readonly subjectType?: string;
  readonly sinceSequence?: number;
  readonly limit?: number;
}

export type IntegrityResult =
  | { readonly ok: true; readonly events: number }
  | { readonly ok: false; readonly brokenAtSequence: number };

export interface AuditLog {
  append(input: AuditEventInput): AuditEvent;
  query(filter?: AuditQuery): readonly AuditEvent[];
  verifyIntegrity(): IntegrityResult;
}

export const GENESIS_HASH = 'genesis';

/** Field order is fixed so the hash is deterministic. */
const HASHED_FIELDS: readonly (keyof AuditEvent)[] = [
  'id',
  'sequence',
  'occurredAt',
  'previousHash',
  'actorType',
  'actorId',
  'action',
  'subjectType',
  'subjectId',
  'organizationId',
  'facilityId',
  'purpose',
  'requestId',
  'policyDecision',
  'breakGlassReason',
  'summary',
];

export function computeEventHash(event: Omit<AuditEvent, 'hash'>): string {
  const hash = createHash('sha256');
  for (const field of HASHED_FIELDS) {
    const value = (event as Record<string, unknown>)[field];
    hash.update(`${field}=${value === undefined ? '' : String(value)}\n`);
  }
  return hash.digest('hex');
}

export interface InMemoryAuditLogOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class InMemoryAuditLog implements AuditLog {
  readonly #events: AuditEvent[] = [];
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: InMemoryAuditLogOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  append(input: AuditEventInput): AuditEvent {
    if (input.actorId.trim() === '' || input.action.trim() === '') {
      throw new Error('audit events require actorId and action');
    }
    const previous = this.#events.at(-1);
    const unhashed: Omit<AuditEvent, 'hash'> = {
      ...input,
      id: this.#newId(),
      sequence: (previous?.sequence ?? 0) + 1,
      occurredAt: this.#now().toISOString(),
      previousHash: previous?.hash ?? GENESIS_HASH,
    };
    const event: AuditEvent = Object.freeze({ ...unhashed, hash: computeEventHash(unhashed) });
    this.#events.push(event);
    return event;
  }

  query(filter: AuditQuery = {}): readonly AuditEvent[] {
    let results = this.#events.filter((e) => {
      if (filter.actorId !== undefined && e.actorId !== filter.actorId) return false;
      if (filter.action !== undefined && e.action !== filter.action) return false;
      if (filter.actionPrefix !== undefined && !e.action.startsWith(filter.actionPrefix)) return false;
      if (filter.facilityId !== undefined && e.facilityId !== filter.facilityId) return false;
      if (filter.subjectType !== undefined && e.subjectType !== filter.subjectType) return false;
      if (filter.sinceSequence !== undefined && e.sequence <= filter.sinceSequence) return false;
      return true;
    });
    if (filter.limit !== undefined && results.length > filter.limit) {
      results = results.slice(-filter.limit);
    }
    return results;
  }

  verifyIntegrity(): IntegrityResult {
    let previousHash = GENESIS_HASH;
    for (const event of this.#events) {
      const { hash, ...rest } = event;
      if (event.previousHash !== previousHash || computeEventHash(rest) !== hash) {
        return { ok: false, brokenAtSequence: event.sequence };
      }
      previousHash = hash;
    }
    return { ok: true, events: this.#events.length };
  }
}

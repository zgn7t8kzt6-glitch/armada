import type { AuditLog } from '@armada/audit';
import type { BreakGlassActivation, UserRecord } from './types.js';

/**
 * Break-glass emergency access (blueprint §11).
 *
 * Explicit reason, time-limited, immediately audited, queued for privacy
 * review. The grant only widens *facility* coverage for PHI reads — the
 * policy engine still refuses writes and Part 2 data (see policy.ts).
 * Callers must tell the user their access is monitored (the policy decision
 * carries an ACCESS_MONITORED_NOTICE obligation).
 */

export interface ActivateBreakGlassInput {
  readonly user: UserRecord;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly reason: string;
  readonly durationMinutes?: number;
  readonly requestId?: string;
}

export interface BreakGlassServiceOptions {
  readonly audit: AuditLog;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly defaultDurationMinutes?: number;
  readonly maxDurationMinutes?: number;
}

const MIN_REASON_LENGTH = 10;

export class BreakGlassService {
  readonly #activations: BreakGlassActivation[] = [];
  readonly #audit: AuditLog;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #defaultDuration: number;
  readonly #maxDuration: number;

  constructor(options: BreakGlassServiceOptions) {
    this.#audit = options.audit;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
    this.#defaultDuration = options.defaultDurationMinutes ?? 15;
    this.#maxDuration = options.maxDurationMinutes ?? 60;
  }

  activate(input: ActivateBreakGlassInput): BreakGlassActivation {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new Error(`Break-glass requires an explicit reason (>= ${MIN_REASON_LENGTH} chars)`);
    }
    if (input.user.status !== 'active') {
      throw new Error('Break-glass requires an active user');
    }
    const duration = input.durationMinutes ?? this.#defaultDuration;
    if (duration < 1 || duration > this.#maxDuration) {
      throw new Error(`Break-glass duration must be 1..${this.#maxDuration} minutes`);
    }
    const now = this.#now();
    const activation: BreakGlassActivation = Object.freeze({
      id: this.#newId(),
      userId: input.user.id,
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      reason,
      activatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + duration * 60_000).toISOString(),
    });
    this.#activations.push(activation);
    // Immediate audit event — before any access happens under the grant.
    this.#audit.append({
      actorType: 'user',
      actorId: input.user.id,
      action: 'break_glass.activated',
      subjectType: 'break_glass',
      subjectId: activation.id,
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      breakGlassReason: reason,
      summary: `duration_minutes=${duration}`,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
    return activation;
  }

  /** Latest unexpired activation for a user (optionally facility-specific). */
  activeFor(userId: string, facilityId?: string): BreakGlassActivation | undefined {
    const now = this.#now().getTime();
    for (let i = this.#activations.length - 1; i >= 0; i -= 1) {
      const activation = this.#activations[i];
      if (activation === undefined) continue;
      if (activation.userId !== userId) continue;
      if (facilityId !== undefined && activation.facilityId !== facilityId) continue;
      if (new Date(activation.expiresAt).getTime() <= now) continue;
      return activation;
    }
    return undefined;
  }

  /** Full history — the privacy review queue reads from here. */
  listForReview(): readonly BreakGlassActivation[] {
    return [...this.#activations];
  }
}

import type { BaselineRole } from '@armada/auth';
import type { Notifier, WorkNotification } from './types.js';

/**
 * In-app notification store. Real channels (email/SMS/push through approved
 * providers) implement the same `Notifier` interface later — the payload is
 * already constrained to PHI-free fields, so adding a less-secure channel
 * cannot leak more than type/priority/due/link (§18).
 */

export interface NotificationQuery {
  readonly roles: readonly BaselineRole[];
  readonly userId?: string;
  /** Facilities the reader covers; 'all' skips facility filtering. */
  readonly facilityIds: 'all' | readonly string[];
  readonly limit?: number;
}

export interface InMemoryNotifierOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class InMemoryNotifier implements Notifier {
  readonly #notifications: WorkNotification[] = [];
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: InMemoryNotifierOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  notify(input: Omit<WorkNotification, 'id' | 'at' | 'channel'>): WorkNotification {
    const notification: WorkNotification = Object.freeze({
      ...input,
      id: this.#newId(),
      at: this.#now().toISOString(),
      channel: 'in_app' as const,
    });
    this.#notifications.push(notification);
    return notification;
  }

  /** Notifications visible to a reader: their roles or them personally,
   * limited to facilities they cover. */
  listFor(query: NotificationQuery): readonly WorkNotification[] {
    const results = this.#notifications.filter((n) => {
      const roleMatch = query.roles.includes(n.recipientRole);
      const personalMatch = query.userId !== undefined && n.recipientUserId === query.userId;
      if (!roleMatch && !personalMatch) return false;
      if (query.facilityIds !== 'all' && !query.facilityIds.includes(n.facilityId)) return false;
      return true;
    });
    const limit = query.limit ?? 100;
    return results.slice(-limit).reverse();
  }

  all(): readonly WorkNotification[] {
    return [...this.#notifications];
  }
}

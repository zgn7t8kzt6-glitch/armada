import type { CanonicalEnvelope, IngestedRecord } from './types.js';

/**
 * Canonical record store with full provenance (blueprint §8). Keyed by
 * (sourceSystem, entityType, sourceRecordId) — vendor IDs are never platform
 * primary keys; the database epic maps these onto canonical entities with
 * internal UUIDs and crosswalks (Epic 9).
 */

export type UpsertOutcome = 'created' | 'updated' | 'unchanged';
export type DeleteOutcome = 'deleted' | 'missing';

function key(sourceSystem: string, entityType: string, sourceRecordId: string): string {
  return `${sourceSystem}:${entityType}:${sourceRecordId}`;
}

export interface RecordStoreOptions {
  readonly now?: () => Date;
}

export class InMemoryIngestedRecordStore {
  readonly #records = new Map<string, IngestedRecord>();
  readonly #now: () => Date;

  constructor(options: RecordStoreOptions = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  upsert(envelope: CanonicalEnvelope, connectorVersion: string): UpsertOutcome {
    const k = key(envelope.sourceSystem, envelope.entityType, envelope.sourceRecordId);
    const existing = this.#records.get(k);
    // Idempotency (§12): the same content hash is a duplicate delivery, not
    // a change — record the reconciliation touch and move on.
    if (existing !== undefined && !existing.deleted && existing.contentHash === envelope.checksum) {
      this.#records.set(
        k,
        Object.freeze({ ...existing, lastReconciledAt: this.#now().toISOString() }),
      );
      return 'unchanged';
    }
    const record: IngestedRecord = Object.freeze({
      sourceSystem: envelope.sourceSystem,
      entityType: envelope.entityType,
      sourceRecordId: envelope.sourceRecordId,
      sourceUpdatedAt: envelope.sourceUpdatedAt,
      retrievedAt: envelope.retrievedAt,
      connectorVersion,
      mappingVersion: envelope.mappingVersion,
      contentHash: envelope.checksum,
      lastReconciledAt: this.#now().toISOString(),
      classification: envelope.classification,
      payload: envelope.payload,
      deleted: false,
    });
    this.#records.set(k, record);
    return existing === undefined || existing.deleted ? 'created' : 'updated';
  }

  /** Source deletions become tombstones — provenance is never destroyed. */
  markDeleted(envelope: CanonicalEnvelope): DeleteOutcome {
    const k = key(envelope.sourceSystem, envelope.entityType, envelope.sourceRecordId);
    const existing = this.#records.get(k);
    if (existing === undefined) return 'missing';
    this.#records.set(
      k,
      Object.freeze({ ...existing, deleted: true, lastReconciledAt: this.#now().toISOString() }),
    );
    return 'deleted';
  }

  get(sourceSystem: string, entityType: string, sourceRecordId: string): IngestedRecord | undefined {
    return this.#records.get(key(sourceSystem, entityType, sourceRecordId));
  }

  list(
    filter: { sourceSystem?: string; entityType?: string; includeDeleted?: boolean } = {},
  ): readonly IngestedRecord[] {
    return [...this.#records.values()].filter((r) => {
      if (filter.sourceSystem !== undefined && r.sourceSystem !== filter.sourceSystem) return false;
      if (filter.entityType !== undefined && r.entityType !== filter.entityType) return false;
      if (filter.includeDeleted !== true && r.deleted) return false;
      return true;
    });
  }

  /** Reconciliation counts by entity type (live records only). */
  countsByEntityType(sourceSystem?: string): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const record of this.#records.values()) {
      if (record.deleted) continue;
      if (sourceSystem !== undefined && record.sourceSystem !== sourceSystem) continue;
      counts[record.entityType] = (counts[record.entityType] ?? 0) + 1;
    }
    return counts;
  }
}

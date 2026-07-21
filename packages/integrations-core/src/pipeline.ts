import type { AuditLog } from '@armada/audit';
import type { MappingRegistry } from './mappings.js';
import type { InMemoryIngestedRecordStore } from './store.js';
import { validateEnvelope } from './validate.js';
import type { CanonicalEnvelope, SourceConnector, SyncCursor } from './types.js';

/**
 * Idempotent ingestion pipeline (blueprint §12):
 *  - schema validation → invalid envelopes quarantined (never retried);
 *  - mapping-version check against the registry → unknown versions quarantined;
 *  - store failures retried with exponential backoff, then dead-lettered;
 *  - duplicate deliveries recognized by content hash;
 *  - cursor checkpoint persisted per connector for resume;
 *  - reconciliation counts per run, with volume-anomaly detection;
 *  - PHI-safe: audit events and errors carry identifiers only, never payloads.
 */

export interface IngestionCounts {
  readonly read: number;
  readonly created: number;
  readonly updated: number;
  readonly unchangedDuplicates: number;
  readonly deleted: number;
  readonly quarantined: number;
  readonly deadLettered: number;
}

export interface IngestionRunRecord {
  readonly runId: string;
  readonly connectorName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: 'succeeded' | 'failed';
  readonly counts: IngestionCounts;
  readonly cursorBefore: string | null;
  readonly cursorAfter: string | null;
  readonly volumeAnomaly: boolean;
  readonly failureReason?: string;
}

export interface QuarantineEntry {
  readonly id: string;
  readonly connectorName: string;
  readonly reason: string;
  readonly at: string;
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly sourceRecordId: string;
  /** Kept for forensic review in the console; never logged or audited. */
  readonly envelope: CanonicalEnvelope;
}

export interface DeadLetterEntry {
  readonly id: string;
  readonly connectorName: string;
  readonly attempts: number;
  readonly lastError: string;
  readonly at: string;
  readonly envelope: CanonicalEnvelope;
}

interface MutableCounts {
  read: number;
  created: number;
  updated: number;
  unchangedDuplicates: number;
  deleted: number;
  quarantined: number;
  deadLettered: number;
}

export interface PipelineOptions {
  readonly audit: AuditLog;
  readonly store: InMemoryIngestedRecordStore;
  readonly mappings: MappingRegistry;
  readonly connectorVersion?: string;
  readonly maxAttempts?: number;
  readonly backoffBaseMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Volume anomaly: reads deviating beyond this factor vs the previous run. */
  readonly anomalyFactor?: number;
  readonly anomalyMinReads?: number;
  readonly onAnomaly?: (run: IngestionRunRecord, previousReads: number) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class IngestionPipeline {
  readonly #runs: IngestionRunRecord[] = [];
  readonly #quarantine: QuarantineEntry[] = [];
  readonly #deadLetters: DeadLetterEntry[] = [];
  readonly #cursors = new Map<string, string | null>();
  readonly #o: Required<Omit<PipelineOptions, 'onAnomaly'>> & Pick<PipelineOptions, 'onAnomaly'>;

  constructor(options: PipelineOptions) {
    this.#o = {
      audit: options.audit,
      store: options.store,
      mappings: options.mappings,
      connectorVersion: options.connectorVersion ?? '0.1.0',
      maxAttempts: options.maxAttempts ?? 3,
      backoffBaseMs: options.backoffBaseMs ?? 250,
      sleep: options.sleep ?? defaultSleep,
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? (() => crypto.randomUUID()),
      anomalyFactor: options.anomalyFactor ?? 1.5,
      anomalyMinReads: options.anomalyMinReads ?? 10,
      ...(options.onAnomaly !== undefined ? { onAnomaly: options.onAnomaly } : {}),
    };
  }

  async run(connector: SourceConnector): Promise<IngestionRunRecord> {
    const runId = this.#o.newId();
    const startedAt = this.#o.now().toISOString();
    const cursorBefore = this.#cursors.get(connector.name) ?? null;
    let cursorAfter = cursorBefore;
    const counts: MutableCounts = {
      read: 0,
      created: 0,
      updated: 0,
      unchangedDuplicates: 0,
      deleted: 0,
      quarantined: 0,
      deadLettered: 0,
    };
    let status: 'succeeded' | 'failed' = 'succeeded';
    let failureReason: string | undefined;

    try {
      const cursor: SyncCursor | undefined =
        cursorBefore !== null ? { position: cursorBefore } : undefined;
      for await (const envelope of connector.pull(cursor)) {
        counts.read += 1;
        await this.#process(connector, envelope, counts);
        if (connector.cursorAfter !== undefined) {
          cursorAfter = connector.cursorAfter(envelope).position;
        }
      }
      this.#cursors.set(connector.name, cursorAfter);
    } catch (err) {
      status = 'failed';
      failureReason = err instanceof Error ? err.message : 'connector pull failed';
      // Cursor is NOT advanced on a failed run; the next run resumes safely.
    }

    const previous = [...this.#runs]
      .reverse()
      .find((r) => r.connectorName === connector.name && r.status === 'succeeded');
    const volumeAnomaly =
      status === 'succeeded' &&
      previous !== undefined &&
      previous.counts.read >= this.#o.anomalyMinReads &&
      (counts.read > previous.counts.read * this.#o.anomalyFactor ||
        counts.read < previous.counts.read / this.#o.anomalyFactor);

    const run: IngestionRunRecord = Object.freeze({
      runId,
      connectorName: connector.name,
      startedAt,
      finishedAt: this.#o.now().toISOString(),
      status,
      counts: Object.freeze({ ...counts }),
      cursorBefore,
      cursorAfter: status === 'succeeded' ? cursorAfter : cursorBefore,
      volumeAnomaly,
      ...(failureReason !== undefined ? { failureReason } : {}),
    });
    this.#runs.push(run);

    this.#o.audit.append({
      actorType: 'service',
      actorId: `connector:${connector.name}`,
      action: status === 'succeeded' ? 'ingestion.run_completed' : 'ingestion.run_failed',
      subjectType: 'ingestion_run',
      subjectId: runId,
      summary:
        `read=${counts.read} created=${counts.created} updated=${counts.updated} ` +
        `duplicates=${counts.unchangedDuplicates} deleted=${counts.deleted} ` +
        `quarantined=${counts.quarantined} dead_lettered=${counts.deadLettered}` +
        (failureReason !== undefined ? ` failure=${failureReason}` : ''),
    });

    if (volumeAnomaly) {
      this.#o.audit.append({
        actorType: 'service',
        actorId: `connector:${connector.name}`,
        action: 'ingestion.volume_anomaly',
        subjectType: 'ingestion_run',
        subjectId: runId,
        summary: `read=${counts.read} previous_read=${previous?.counts.read ?? 0}`,
      });
      this.#o.onAnomaly?.(run, previous?.counts.read ?? 0);
    }

    return run;
  }

  async #process(
    connector: SourceConnector,
    envelope: CanonicalEnvelope,
    counts: MutableCounts,
  ): Promise<void> {
    const validation = validateEnvelope(envelope);
    if (!validation.ok) {
      this.#quarantineEnvelope(connector.name, envelope, validation.reason);
      counts.quarantined += 1;
      return;
    }
    if (!this.#o.mappings.matches(envelope)) {
      this.#quarantineEnvelope(connector.name, envelope, 'unregistered_mapping_version');
      counts.quarantined += 1;
      return;
    }

    for (let attempt = 1; attempt <= this.#o.maxAttempts; attempt += 1) {
      try {
        if (envelope.operation === 'DELETE') {
          if (this.#o.store.markDeleted(envelope) === 'deleted') counts.deleted += 1;
          return;
        }
        const outcome = this.#o.store.upsert(envelope, this.#o.connectorVersion);
        if (outcome === 'created') counts.created += 1;
        else if (outcome === 'updated') counts.updated += 1;
        else counts.unchangedDuplicates += 1;
        return;
      } catch (err) {
        if (attempt === this.#o.maxAttempts) {
          this.#deadLetters.push(
            Object.freeze({
              id: this.#o.newId(),
              connectorName: connector.name,
              attempts: attempt,
              lastError: err instanceof Error ? err.message : 'processing failed',
              at: this.#o.now().toISOString(),
              envelope,
            }),
          );
          counts.deadLettered += 1;
          this.#o.audit.append({
            actorType: 'service',
            actorId: `connector:${connector.name}`,
            action: 'ingestion.dead_lettered',
            subjectType: envelope.entityType,
            subjectId: envelope.sourceRecordId,
            summary: `attempts=${attempt}`,
          });
          return;
        }
        await this.#o.sleep(this.#o.backoffBaseMs * 2 ** (attempt - 1));
      }
    }
  }

  #quarantineEnvelope(connectorName: string, envelope: CanonicalEnvelope, reason: string): void {
    this.#quarantine.push(
      Object.freeze({
        id: this.#o.newId(),
        connectorName,
        reason,
        at: this.#o.now().toISOString(),
        sourceSystem: envelope.sourceSystem,
        entityType: envelope.entityType,
        sourceRecordId: envelope.sourceRecordId,
        envelope,
      }),
    );
    // Identifiers only — the payload never reaches audit or logs.
    this.#o.audit.append({
      actorType: 'service',
      actorId: `connector:${connectorName}`,
      action: 'ingestion.quarantined',
      subjectType: envelope.entityType || 'unknown',
      subjectId: envelope.sourceRecordId || 'unknown',
      summary: `reason=${reason}`,
    });
  }

  /** Reprocess dead letters for a connector (after the fault is fixed). */
  async redriveDeadLetters(connector: SourceConnector): Promise<IngestionCounts> {
    const mine = this.#deadLetters.filter((d) => d.connectorName === connector.name);
    const counts: MutableCounts = {
      read: mine.length,
      created: 0,
      updated: 0,
      unchangedDuplicates: 0,
      deleted: 0,
      quarantined: 0,
      deadLettered: 0,
    };
    // Remove first; failures re-enter the queue through #process.
    for (const entry of mine) {
      const index = this.#deadLetters.indexOf(entry);
      if (index !== -1) this.#deadLetters.splice(index, 1);
    }
    for (const entry of mine) {
      await this.#process(connector, entry.envelope, counts);
    }
    return Object.freeze({ ...counts });
  }

  runs(connectorName?: string): readonly IngestionRunRecord[] {
    return connectorName === undefined
      ? [...this.#runs]
      : this.#runs.filter((r) => r.connectorName === connectorName);
  }

  lastRun(connectorName: string): IngestionRunRecord | undefined {
    return [...this.#runs].reverse().find((r) => r.connectorName === connectorName);
  }

  quarantine(connectorName?: string): readonly QuarantineEntry[] {
    return connectorName === undefined
      ? [...this.#quarantine]
      : this.#quarantine.filter((q) => q.connectorName === connectorName);
  }

  deadLetters(connectorName?: string): readonly DeadLetterEntry[] {
    return connectorName === undefined
      ? [...this.#deadLetters]
      : this.#deadLetters.filter((d) => d.connectorName === connectorName);
  }

  cursor(connectorName: string): string | null {
    return this.#cursors.get(connectorName) ?? null;
  }
}

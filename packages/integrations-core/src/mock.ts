import { computeChecksum } from './checksum.js';
import type {
  CanonicalEnvelope,
  ConnectorCapabilities,
  EnvelopeClassification,
  HealthStatus,
  SourceConnector,
  SourceSystem,
  SyncCursor,
} from './types.js';

/**
 * Factory for synthetic mock connectors (blueprint §13: "until verified,
 * implement only a connector interface plus synthetic mock adapter").
 *
 * Mock connectors generate deterministic synthetic envelopes so the
 * ingestion pipeline, reconciliation, and dashboards can be built and
 * tested without any vendor behavior being invented. `write` is never
 * implemented and `supportsWrite` is always false.
 */

export interface MockEntitySpec {
  readonly entityType: string;
  readonly classification: readonly EnvelopeClassification[];
  /** Deterministic synthetic payload for sequence n. */
  readonly payloadFor: (sequence: number) => Readonly<Record<string, unknown>>;
}

export interface MockConnectorConfig {
  readonly name: string;
  readonly sourceSystem: SourceSystem;
  readonly schemaVersion: string;
  readonly mappingVersion: string;
  readonly docsRef: string;
  readonly entities: readonly MockEntitySpec[];
  /** Total records per entity type in the simulated source. */
  readonly recordsPerEntity: number;
  /** Emit one envelope with a corrupted checksum (quarantine testing). */
  readonly includeMalformed?: boolean;
  /** Report unhealthy from healthCheck (downtime testing). */
  readonly simulateUnhealthy?: boolean;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

function validateConfig(config: MockConnectorConfig): void {
  if (config.name.trim() === '' || !config.name.startsWith('mock-')) {
    throw new Error('Mock connector names must start with "mock-"');
  }
  if (config.entities.length === 0) {
    throw new Error('Mock connector requires at least one entity spec');
  }
  if (config.recordsPerEntity < 1 || config.recordsPerEntity > 10_000) {
    throw new Error('recordsPerEntity must be 1..10000');
  }
  for (const entity of config.entities) {
    if (entity.entityType.trim() === '') {
      throw new Error('entityType must not be empty');
    }
  }
}

export class MockConnector implements SourceConnector {
  readonly name: string;
  readonly #config: MockConnectorConfig;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(config: MockConnectorConfig) {
    validateConfig(config);
    this.name = config.name;
    this.#config = config;
    this.#now = config.now ?? (() => new Date());
    this.#newId = config.newId ?? (() => crypto.randomUUID());
  }

  capabilities(): Promise<ConnectorCapabilities> {
    return Promise.resolve({
      sourceSystem: this.#config.sourceSystem,
      entityTypes: this.#config.entities.map((e) => e.entityType),
      supportsPull: true,
      supportsWebhooks: false,
      supportsWrite: false,
      mock: true,
      docsRef: this.#config.docsRef,
    });
  }

  healthCheck(): Promise<HealthStatus> {
    return Promise.resolve({
      healthy: this.#config.simulateUnhealthy !== true,
      checkedAt: this.#now().toISOString(),
      ...(this.#config.simulateUnhealthy === true ? { detail: 'simulated outage' } : {}),
    });
  }

  /** Global sequence: entity index cycles fastest, then per-entity sequence. */
  #totalSequences(): number {
    return this.#config.recordsPerEntity * this.#config.entities.length;
  }

  #envelopeFor(globalSequence: number): CanonicalEnvelope {
    const entityIndex = (globalSequence - 1) % this.#config.entities.length;
    const perEntitySequence = Math.ceil(globalSequence / this.#config.entities.length);
    const entity = this.#config.entities[entityIndex];
    if (entity === undefined) throw new Error('entity index out of range');
    const payload = {
      ...entity.payloadFor(perEntitySequence),
      synthetic: true,
      sequence: globalSequence,
    };
    const corrupt =
      this.#config.includeMalformed === true &&
      globalSequence === Math.min(2, this.#totalSequences());
    return {
      eventId: this.#newId(),
      sourceSystem: this.#config.sourceSystem,
      entityType: entity.entityType,
      sourceRecordId: `${entity.entityType}-${perEntitySequence}`,
      operation: 'UPSERT',
      sourceUpdatedAt: this.#now().toISOString(),
      retrievedAt: this.#now().toISOString(),
      schemaVersion: this.#config.schemaVersion,
      mappingVersion: this.#config.mappingVersion,
      classification: entity.classification,
      payload,
      checksum: corrupt ? 'corrupted-checksum' : computeChecksum(payload),
    };
  }

  async *pull(cursor?: SyncCursor): AsyncIterable<CanonicalEnvelope> {
    const start =
      cursor?.position !== undefined && cursor.position !== null
        ? Number.parseInt(cursor.position, 10)
        : 0;
    if (Number.isNaN(start) || start < 0) {
      throw new Error(`Invalid cursor position: ${String(cursor?.position)}`);
    }
    for (let sequence = start + 1; sequence <= this.#totalSequences(); sequence += 1) {
      yield this.#envelopeFor(sequence);
    }
  }

  cursorAfter(envelope: CanonicalEnvelope): SyncCursor {
    const sequence = envelope.payload['sequence'];
    return { position: typeof sequence === 'number' ? String(sequence) : null };
  }

  // No `write` method: write paths are unsupported until the Phase 2 gate.
}

/**
 * Connector SDK — the stable internal contract every vendor integration
 * implements (blueprint §12). Application logic never touches vendor
 * response shapes; only canonical envelopes cross this boundary.
 *
 * Until signed vendor discovery documents exist in docs/integrations/,
 * the only implementations are synthetic mocks (CLAUDE.md #1–2), and all
 * write paths are unsupported and disabled (CLAUDE.md #3).
 */

export const SOURCE_SYSTEMS = ['KIPU', 'SALESFORCE', 'COLLABORATEMD'] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const ENVELOPE_OPERATIONS = ['UPSERT', 'DELETE', 'SNAPSHOT'] as const;
export type EnvelopeOperation = (typeof ENVELOPE_OPERATIONS)[number];

export const ENVELOPE_CLASSIFICATIONS = ['PHI', 'PART2'] as const;
export type EnvelopeClassification = (typeof ENVELOPE_CLASSIFICATIONS)[number];

/** Canonical envelope (§12). The checksum covers the payload. */
export interface CanonicalEnvelope {
  readonly eventId: string;
  readonly sourceSystem: SourceSystem;
  readonly entityType: string;
  readonly sourceRecordId: string;
  readonly operation: EnvelopeOperation;
  readonly sourceUpdatedAt: string | null;
  readonly retrievedAt: string;
  readonly schemaVersion: string;
  readonly mappingVersion: string;
  readonly classification: readonly EnvelopeClassification[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly checksum: string;
}

export interface ConnectorCapabilities {
  readonly sourceSystem: SourceSystem;
  readonly entityTypes: readonly string[];
  readonly supportsPull: boolean;
  readonly supportsWebhooks: boolean;
  /** Must be false until a Phase 2 gate approves a specific write workflow. */
  readonly supportsWrite: boolean;
  /** True for synthetic mock adapters. */
  readonly mock: boolean;
  /** Where the vendor capability evidence lives (or will live). */
  readonly docsRef: string;
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface SyncCursor {
  /** Opaque connector-defined position; null means start from the beginning. */
  readonly position: string | null;
}

export interface IngestionReceipt {
  readonly runId: string;
  readonly acceptedEventIds: readonly string[];
}

/** Write types exist so the contract is complete; no connector may
 * implement them until the blueprint Phase 2 gate is passed. */
export interface ApprovedWriteCommand {
  readonly commandId: string;
  readonly workflow: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WriteResult {
  readonly commandId: string;
  readonly status: 'accepted' | 'rejected';
  readonly detail?: string;
}

export interface SourceConnector {
  readonly name: string;
  capabilities(): Promise<ConnectorCapabilities>;
  healthCheck(): Promise<HealthStatus>;
  pull(cursor?: SyncCursor): AsyncIterable<CanonicalEnvelope>;
  /** Derive the resume cursor that follows a processed envelope. */
  cursorAfter?(envelope: CanonicalEnvelope): SyncCursor;
  acknowledge?(receipt: IngestionReceipt): Promise<void>;
  write?(command: ApprovedWriteCommand): Promise<WriteResult>;
}

/** Provenance carried by every imported record (blueprint §8). */
export interface IngestedRecord {
  readonly sourceSystem: SourceSystem;
  readonly entityType: string;
  readonly sourceRecordId: string;
  readonly sourceRecordVersion?: string;
  readonly sourceUpdatedAt: string | null;
  readonly retrievedAt: string;
  readonly connectorVersion: string;
  readonly mappingVersion: string;
  readonly contentHash: string;
  readonly lastReconciledAt: string;
  readonly classification: readonly EnvelopeClassification[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly deleted: boolean;
}

export class WriteDisabledError extends Error {
  constructor(connectorName: string) {
    super(
      `Connector "${connectorName}" write path is disabled: vendor write workflows require ` +
        'the blueprint Phase 2 gate (signed risk assessment, sandbox test, rollback plan) ' +
        'and remain unsupported until then (CLAUDE.md #3).',
    );
    this.name = 'WriteDisabledError';
  }
}

/** Uniform guard for any code path that would reach a vendor write. */
export function assertWritePathDisabled(connectorName: string): never {
  throw new WriteDisabledError(connectorName);
}

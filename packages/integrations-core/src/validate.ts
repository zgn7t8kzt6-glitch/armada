import { computeChecksum } from './checksum.js';
import {
  ENVELOPE_CLASSIFICATIONS,
  ENVELOPE_OPERATIONS,
  SOURCE_SYSTEMS,
  type CanonicalEnvelope,
} from './types.js';

/**
 * Envelope schema validation (blueprint §12). Returns a reason instead of
 * throwing so the pipeline can quarantine without a try/catch per field.
 * Reasons never include payload content — they are safe for logs/audit.
 */

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function validateEnvelope(envelope: CanonicalEnvelope): ValidationResult {
  if (!isNonEmptyString(envelope.eventId)) return { ok: false, reason: 'missing_event_id' };
  if (!(SOURCE_SYSTEMS as readonly string[]).includes(envelope.sourceSystem)) {
    return { ok: false, reason: 'unknown_source_system' };
  }
  if (!isNonEmptyString(envelope.entityType)) return { ok: false, reason: 'missing_entity_type' };
  if (!isNonEmptyString(envelope.sourceRecordId)) {
    return { ok: false, reason: 'missing_source_record_id' };
  }
  if (!(ENVELOPE_OPERATIONS as readonly string[]).includes(envelope.operation)) {
    return { ok: false, reason: 'unknown_operation' };
  }
  if (envelope.sourceUpdatedAt !== null && Number.isNaN(Date.parse(envelope.sourceUpdatedAt))) {
    return { ok: false, reason: 'invalid_source_updated_at' };
  }
  if (!isNonEmptyString(envelope.retrievedAt) || Number.isNaN(Date.parse(envelope.retrievedAt))) {
    return { ok: false, reason: 'invalid_retrieved_at' };
  }
  if (!isNonEmptyString(envelope.schemaVersion)) return { ok: false, reason: 'missing_schema_version' };
  if (!isNonEmptyString(envelope.mappingVersion)) {
    return { ok: false, reason: 'missing_mapping_version' };
  }
  if (!Array.isArray(envelope.classification)) {
    return { ok: false, reason: 'invalid_classification' };
  }
  for (const tag of envelope.classification) {
    if (!(ENVELOPE_CLASSIFICATIONS as readonly string[]).includes(tag)) {
      return { ok: false, reason: 'invalid_classification' };
    }
  }
  if (typeof envelope.payload !== 'object' || envelope.payload === null) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (envelope.checksum !== computeChecksum(envelope.payload)) {
    return { ok: false, reason: 'checksum_mismatch' };
  }
  return { ok: true };
}

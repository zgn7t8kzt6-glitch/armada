import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { computeChecksum } from './checksum.js';
import { MappingRegistry } from './mappings.js';
import { MockConnector } from './mock.js';
import { IngestionPipeline } from './pipeline.js';
import { InMemoryIngestedRecordStore } from './store.js';
import { validateEnvelope } from './validate.js';
import type { CanonicalEnvelope } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');

function makeEnvelope(overrides: Partial<CanonicalEnvelope> = {}): CanonicalEnvelope {
  const payload = overrides.payload ?? { synthetic: true, value: 1 };
  return {
    eventId: 'evt-1',
    sourceSystem: 'KIPU',
    entityType: 'census_snapshot',
    sourceRecordId: 'census-1',
    operation: 'UPSERT',
    sourceUpdatedAt: NOW().toISOString(),
    retrievedAt: NOW().toISOString(),
    schemaVersion: 'mock-1',
    mappingVersion: 'map-1',
    classification: [],
    payload,
    checksum: computeChecksum(payload),
    ...overrides,
  };
}

function makeMappings(): MappingRegistry {
  const mappings = new MappingRegistry();
  mappings.register({
    sourceSystem: 'KIPU',
    entityType: 'census_snapshot',
    schemaVersion: 'mock-1',
    mappingVersion: 'map-1',
  });
  return mappings;
}

function makeConnector(envelopes: readonly CanonicalEnvelope[], name = 'mock-test') {
  return {
    name,
    capabilities: () =>
      Promise.resolve({
        sourceSystem: 'KIPU' as const,
        entityTypes: ['census_snapshot'],
        supportsPull: true,
        supportsWebhooks: false,
        supportsWrite: false,
        mock: true,
        docsRef: 'docs/vendor-discovery/kipu-capability-matrix.md',
      }),
    healthCheck: () => Promise.resolve({ healthy: true, checkedAt: NOW().toISOString() }),
    async *pull() {
      for (const envelope of envelopes) yield envelope;
    },
  };
}

function makePipeline(overrides: { store?: InMemoryIngestedRecordStore; onAnomaly?: () => void } = {}) {
  const audit = new InMemoryAuditLog({ now: NOW });
  const store = overrides.store ?? new InMemoryIngestedRecordStore({ now: NOW });
  const pipeline = new IngestionPipeline({
    audit,
    store,
    mappings: makeMappings(),
    sleep: () => Promise.resolve(),
    now: NOW,
    anomalyMinReads: 2,
    ...(overrides.onAnomaly !== undefined ? { onAnomaly: overrides.onAnomaly } : {}),
  });
  return { audit, store, pipeline };
}

test('envelope validation catches every malformed field with safe reasons', () => {
  assert.equal(validateEnvelope(makeEnvelope()).ok, true);
  const cases: [Partial<CanonicalEnvelope>, string][] = [
    [{ eventId: '' }, 'missing_event_id'],
    [{ sourceSystem: 'EPIC' as never }, 'unknown_source_system'],
    [{ entityType: ' ' }, 'missing_entity_type'],
    [{ sourceRecordId: '' }, 'missing_source_record_id'],
    [{ operation: 'MERGE' as never }, 'unknown_operation'],
    [{ sourceUpdatedAt: 'yesterday' }, 'invalid_source_updated_at'],
    [{ retrievedAt: 'nope' }, 'invalid_retrieved_at'],
    [{ schemaVersion: '' }, 'missing_schema_version'],
    [{ mappingVersion: '' }, 'missing_mapping_version'],
    [{ classification: ['SECRET' as never] }, 'invalid_classification'],
    [{ checksum: 'wrong' }, 'checksum_mismatch'],
  ];
  for (const [override, reason] of cases) {
    const result = validateEnvelope(makeEnvelope(override));
    assert.ok(!result.ok && result.reason === reason, `${reason}`);
  }
});

test('idempotency: duplicate deliveries are unchanged, new content updates', async () => {
  const { pipeline, store } = makePipeline();
  const original = makeEnvelope();
  await pipeline.run(makeConnector([original, { ...original, eventId: 'evt-2' }]));
  let run = pipeline.lastRun('mock-test');
  assert.equal(run?.counts.created, 1);
  assert.equal(run?.counts.unchangedDuplicates, 1);

  const changedPayload = { synthetic: true, value: 2 };
  await pipeline.run(
    makeConnector([
      makeEnvelope({ eventId: 'evt-3', payload: changedPayload, checksum: computeChecksum(changedPayload) }),
    ]),
  );
  run = pipeline.lastRun('mock-test');
  assert.equal(run?.counts.updated, 1);
  const record = store.get('KIPU', 'census_snapshot', 'census-1');
  assert.equal(record?.payload['value'], 2);
  assert.equal(record?.contentHash, computeChecksum(changedPayload));
  assert.equal(record?.mappingVersion, 'map-1');
});

test('DELETE operations tombstone records without destroying provenance', async () => {
  const { pipeline, store } = makePipeline();
  await pipeline.run(makeConnector([makeEnvelope()]));
  await pipeline.run(makeConnector([makeEnvelope({ eventId: 'evt-2', operation: 'DELETE' })]));
  assert.equal(pipeline.lastRun('mock-test')?.counts.deleted, 1);
  assert.equal(store.list().length, 0);
  const tombstone = store.list({ includeDeleted: true })[0];
  assert.equal(tombstone?.deleted, true);
  assert.equal(tombstone?.contentHash.length, 64);
});

test('invalid envelopes and unregistered mappings are quarantined, audited without payloads', async () => {
  const { pipeline, audit } = makePipeline();
  const bad = makeEnvelope({ checksum: 'corrupted' });
  const unknownMapping = makeEnvelope({ eventId: 'evt-2', mappingVersion: 'map-99' });
  await pipeline.run(makeConnector([bad, unknownMapping]));
  const run = pipeline.lastRun('mock-test');
  assert.equal(run?.counts.quarantined, 2);
  const entries = pipeline.quarantine('mock-test');
  assert.deepEqual(
    entries.map((q) => q.reason).sort(),
    ['checksum_mismatch', 'unregistered_mapping_version'],
  );
  const events = audit.query({ action: 'ingestion.quarantined' });
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.ok(!JSON.stringify(event).includes('synthetic'), 'no payload contents in audit');
  }
});

test('store failures retry with backoff then dead-letter; redrive recovers', async () => {
  const store = new InMemoryIngestedRecordStore({ now: NOW });
  let failuresRemaining = 6; // 2 envelopes × 3 attempts — everything fails first run
  const realUpsert = store.upsert.bind(store);
  store.upsert = (envelope, version) => {
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error('simulated store outage');
    }
    return realUpsert(envelope, version);
  };
  const { pipeline } = makePipeline({ store });
  const connector = makeConnector([
    makeEnvelope(),
    makeEnvelope({ eventId: 'evt-2', sourceRecordId: 'census-2' }),
  ]);
  await pipeline.run(connector);
  const run = pipeline.lastRun('mock-test');
  assert.equal(run?.counts.deadLettered, 2);
  assert.equal(pipeline.deadLetters('mock-test').length, 2);
  assert.equal(pipeline.deadLetters('mock-test')[0]?.attempts, 3);

  // Outage over: redrive drains the queue.
  const counts = await pipeline.redriveDeadLetters(connector);
  assert.equal(counts.created, 2);
  assert.equal(pipeline.deadLetters('mock-test').length, 0);
});

test('connector pull failure marks the run failed and does not advance the cursor', async () => {
  const { pipeline } = makePipeline();
  const kipu = new MockConnector({
    name: 'mock-cursor',
    sourceSystem: 'KIPU',
    schemaVersion: 'mock-1',
    mappingVersion: 'map-1',
    docsRef: 'docs/vendor-discovery/kipu-capability-matrix.md',
    entities: [
      { entityType: 'census_snapshot', classification: [], payloadFor: (n) => ({ n }) },
    ],
    recordsPerEntity: 3,
    now: NOW,
  });
  await pipeline.run(kipu);
  assert.equal(pipeline.cursor('mock-cursor'), '3');

  const failing = {
    ...makeConnector([], 'mock-cursor'),
    // eslint-disable-next-line require-yield
    async *pull(): AsyncIterable<CanonicalEnvelope> {
      throw new Error('vendor timeout');
    },
  };
  const run = await pipeline.run(failing);
  assert.equal(run.status, 'failed');
  assert.match(run.failureReason ?? '', /vendor timeout/);
  assert.equal(pipeline.cursor('mock-cursor'), '3', 'cursor unchanged after failure');
});

test('cursor checkpointing: second run reads nothing new from an unchanged source', async () => {
  const { pipeline } = makePipeline();
  const kipu = new MockConnector({
    name: 'mock-kipu-x',
    sourceSystem: 'KIPU',
    schemaVersion: 'mock-1',
    mappingVersion: 'map-1',
    docsRef: 'docs/vendor-discovery/kipu-capability-matrix.md',
    entities: [{ entityType: 'census_snapshot', classification: [], payloadFor: (n) => ({ n }) }],
    recordsPerEntity: 5,
    now: NOW,
  });
  const first = await pipeline.run(kipu);
  assert.equal(first.counts.read, 5);
  assert.equal(first.counts.created, 5);
  const second = await pipeline.run(kipu);
  assert.equal(second.counts.read, 0, 'resumed from checkpoint');
});

test('volume anomaly fires audit + callback when reads swing beyond the factor', async () => {
  let anomalies = 0;
  const { pipeline, audit } = makePipeline({ onAnomaly: () => (anomalies += 1) });
  const big = Array.from({ length: 10 }, (_, i) =>
    makeEnvelope({ eventId: `evt-${i}`, sourceRecordId: `census-${i}` }),
  );
  await pipeline.run(makeConnector(big));
  await pipeline.run(makeConnector([makeEnvelope({ eventId: 'only' })]));
  const run = pipeline.lastRun('mock-test');
  assert.equal(run?.volumeAnomaly, true);
  assert.equal(anomalies, 1);
  assert.equal(audit.query({ action: 'ingestion.volume_anomaly' }).length, 1);
});

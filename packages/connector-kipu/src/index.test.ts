import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertConnectorContract } from '@armada/integrations-core';
import { createMockKipuConnector, kipuMappingRegistrations } from './index.js';

test('mock Kipu connector passes the connector contract', async () => {
  await assertConnectorContract(
    createMockKipuConnector({ facilityIds: ['fac-akron', 'fac-columbus'] }),
  );
});

test('capabilities declare a read-only mock pointing at the discovery doc', async () => {
  const connector = createMockKipuConnector({ facilityIds: ['fac-akron'] });
  const capabilities = await connector.capabilities();
  assert.equal(capabilities.mock, true);
  assert.equal(capabilities.supportsWrite, false);
  assert.match(capabilities.docsRef, /kipu-capability-matrix/);
  assert.deepEqual(capabilities.entityTypes, [
    'census_snapshot',
    'admission_event',
    'authorization_summary',
  ]);
});

test('config validation and mapping registrations', () => {
  assert.throws(() => createMockKipuConnector({ facilityIds: [] }), /at least one facilityId/);
  const registrations = kipuMappingRegistrations();
  assert.equal(registrations.length, 3);
  assert.ok(registrations.every((r) => r.sourceSystem === 'KIPU'));
});

test('synthetic payloads are flagged synthetic and cycle facilities', async () => {
  const connector = createMockKipuConnector({
    facilityIds: ['fac-akron', 'fac-columbus'],
    recordsPerEntity: 2,
  });
  const facilities = new Set<string>();
  for await (const envelope of connector.pull()) {
    assert.equal(envelope.payload['synthetic'], true);
    const facilityId = envelope.payload['facilityId'];
    if (typeof facilityId === 'string') facilities.add(facilityId);
  }
  assert.deepEqual([...facilities].sort(), ['fac-akron', 'fac-columbus']);
});

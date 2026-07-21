import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertConnectorContract } from '@armada/integrations-core';
import { collaborateMdMappingRegistrations, createMockCollaborateMdConnector } from './index.js';

test('mock CollaborateMD connector passes the connector contract', async () => {
  await assertConnectorContract(createMockCollaborateMdConnector());
});

test('capabilities: read-only mock, discovery doc, revenue-cycle summaries only', async () => {
  const capabilities = await createMockCollaborateMdConnector().capabilities();
  assert.equal(capabilities.mock, true);
  assert.equal(capabilities.supportsWrite, false);
  assert.match(capabilities.docsRef, /collaboratemd-capability-matrix/);
  assert.deepEqual(capabilities.entityTypes, ['claim_summary', 'denial_summary', 'payment_summary']);
});

test('unhealthy simulation reports through healthCheck; registrations complete', async () => {
  const down = createMockCollaborateMdConnector({ simulateUnhealthy: true });
  const health = await down.healthCheck();
  assert.equal(health.healthy, false);
  assert.match(health.detail ?? '', /simulated/);
  assert.equal(collaborateMdMappingRegistrations().length, 3);
});

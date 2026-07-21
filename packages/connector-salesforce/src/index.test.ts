import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertConnectorContract } from '@armada/integrations-core';
import { createMockSalesforceConnector, salesforceMappingRegistrations } from './index.js';

test('mock Salesforce connector passes the connector contract', async () => {
  await assertConnectorContract(createMockSalesforceConnector());
});

test('capabilities: read-only mock, discovery doc, growth entity types', async () => {
  const capabilities = await createMockSalesforceConnector().capabilities();
  assert.equal(capabilities.mock, true);
  assert.equal(capabilities.supportsWrite, false);
  assert.match(capabilities.docsRef, /salesforce-org-assessment/);
  assert.deepEqual(capabilities.entityTypes, ['lead', 'referral_organization', 'admission_opportunity']);
});

test('leads and opportunities are PHI-classified; registrations complete', async () => {
  const connector = createMockSalesforceConnector({ recordsPerEntity: 2 });
  for await (const envelope of connector.pull()) {
    if (envelope.entityType === 'lead' || envelope.entityType === 'admission_opportunity') {
      assert.deepEqual(envelope.classification, ['PHI'], envelope.entityType);
    }
    assert.equal(envelope.payload['synthetic'], true);
  }
  assert.equal(salesforceMappingRegistrations().length, 3);
});

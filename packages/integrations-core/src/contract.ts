import assert from 'node:assert/strict';
import { validateEnvelope } from './validate.js';
import type { CanonicalEnvelope, SourceConnector } from './types.js';

/**
 * Contract-test kit (blueprint §24: contract tests for connectors).
 * Every connector package runs this against its implementation; a real
 * vendor adapter must pass the same assertions the mocks pass.
 */
export async function assertConnectorContract(connector: SourceConnector): Promise<void> {
  const capabilities = await connector.capabilities();
  assert.ok(capabilities.entityTypes.length > 0, 'capabilities list entity types');
  assert.equal(capabilities.supportsWrite, false, 'write must be unsupported (CLAUDE.md #3)');
  assert.equal(connector.write, undefined, 'no write method may exist before the Phase 2 gate');
  assert.ok(capabilities.docsRef.length > 0, 'capabilities point at vendor evidence location');

  const health = await connector.healthCheck();
  assert.ok(typeof health.healthy === 'boolean');
  assert.ok(!Number.isNaN(Date.parse(health.checkedAt)));

  // Full pull yields only valid envelopes with declared entity types.
  const envelopes: CanonicalEnvelope[] = [];
  for await (const envelope of connector.pull()) {
    envelopes.push(envelope);
  }
  assert.ok(envelopes.length > 0, 'pull yields envelopes');
  for (const envelope of envelopes) {
    const validation = validateEnvelope(envelope);
    assert.ok(validation.ok, `envelope invalid: ${!validation.ok ? validation.reason : ''}`);
    assert.ok(capabilities.entityTypes.includes(envelope.entityType));
    assert.equal(envelope.sourceSystem, capabilities.sourceSystem);
  }
  const eventIds = new Set(envelopes.map((e) => e.eventId));
  assert.equal(eventIds.size, envelopes.length, 'event ids are unique');

  // Cursor resume: continuing from the final cursor yields nothing new.
  if (connector.cursorAfter !== undefined) {
    const last = envelopes.at(-1);
    assert.ok(last !== undefined);
    const cursor = connector.cursorAfter(last);
    let resumed = 0;
    for await (const _envelope of connector.pull(cursor)) {
      resumed += 1;
    }
    assert.equal(resumed, 0, 'resume from final cursor yields no duplicates');
  }
}

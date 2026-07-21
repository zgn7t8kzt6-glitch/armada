import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagRegistry, type FlagDefinition } from './index.js';

const WRITE_BACK: FlagDefinition = {
  name: 'CONNECTOR_WRITE_BACK',
  description: 'Enable vendor write paths (Phase 2 gate)',
  risk: 'high',
  owner: 'security-lead',
};

const NEW_UI: FlagDefinition = {
  name: 'NEW_LINEUP_UI',
  description: 'In-progress lineup editor',
  risk: 'standard',
  owner: 'product-owner',
};

test('flags default off', () => {
  const flags = createFlagRegistry([WRITE_BACK, NEW_UI], { nodeEnv: 'development', source: {} });
  assert.equal(flags.isEnabled('CONNECTOR_WRITE_BACK'), false);
  assert.equal(flags.isEnabled('NEW_LINEUP_UI'), false);
});

test('env override enables a standard flag outside production', () => {
  const flags = createFlagRegistry([NEW_UI], {
    nodeEnv: 'development',
    source: { ARMADA_FLAG_NEW_LINEUP_UI: 'true' },
  });
  assert.equal(flags.isEnabled('NEW_LINEUP_UI'), true);
  assert.equal(flags.snapshot()[0]?.resolvedFrom, 'env-override');
});

test('high-risk flag cannot be enabled via env override in production', () => {
  const ignored: string[] = [];
  const flags = createFlagRegistry([WRITE_BACK], {
    nodeEnv: 'production',
    source: { ARMADA_FLAG_CONNECTOR_WRITE_BACK: 'true' },
    onIgnoredOverride: (flag) => ignored.push(flag),
  });
  assert.equal(flags.isEnabled('CONNECTOR_WRITE_BACK'), false);
  assert.deepEqual(ignored, ['CONNECTOR_WRITE_BACK']);
});

test('high-risk flag may be enabled via override outside production', () => {
  const flags = createFlagRegistry([WRITE_BACK], {
    nodeEnv: 'test',
    source: { ARMADA_FLAG_CONNECTOR_WRITE_BACK: 'on' },
  });
  assert.equal(flags.isEnabled('CONNECTOR_WRITE_BACK'), true);
});

test('unknown flags, bad names, duplicates, and bad values are hard errors', () => {
  const flags = createFlagRegistry([NEW_UI], { nodeEnv: 'development', source: {} });
  assert.throws(() => flags.isEnabled('NOT_A_FLAG'));
  assert.throws(() =>
    createFlagRegistry([{ ...NEW_UI, name: 'bad-name' }], { nodeEnv: 'development', source: {} }),
  );
  assert.throws(() =>
    createFlagRegistry([NEW_UI, NEW_UI], { nodeEnv: 'development', source: {} }),
  );
  assert.throws(() =>
    createFlagRegistry([NEW_UI], {
      nodeEnv: 'development',
      source: { ARMADA_FLAG_NEW_LINEUP_UI: 'maybe' },
    }),
  );
});

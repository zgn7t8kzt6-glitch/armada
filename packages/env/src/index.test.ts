import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnvValidationError, baseSchema, isProduction, loadEnv } from './index.js';

test('loads valid configuration with typed values', () => {
  const env = loadEnv(
    {
      API_PORT: { kind: 'port', description: 'listen port' },
      DEBUG: { kind: 'boolean', description: 'debug toggle' },
      NAME: { kind: 'string', description: 'service name' },
      TIER: { kind: 'enum', values: ['a', 'b'] as const, description: 'tier' },
      DB: { kind: 'url', protocols: ['postgresql:'], description: 'database url' },
    },
    {
      API_PORT: '3000',
      DEBUG: 'yes',
      NAME: 'api',
      TIER: 'b',
      DB: 'postgresql://u:p@localhost:5432/x',
    },
  );
  assert.equal(env.API_PORT, 3000);
  assert.equal(env.DEBUG, true);
  assert.equal(env.NAME, 'api');
  assert.equal(env.TIER, 'b');
  assert.equal(env.DB, 'postgresql://u:p@localhost:5432/x');
});

test('applies defaults for missing variables', () => {
  const env = loadEnv(baseSchema, {});
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.LOG_LEVEL, 'info');
  assert.equal(isProduction(env), false);
});

test('collects all problems in one error', () => {
  assert.throws(
    () =>
      loadEnv(
        {
          A: { kind: 'integer', description: 'a' },
          B: { kind: 'port', description: 'b' },
          C: { kind: 'string', description: 'c' },
        },
        { A: 'not-a-number', B: '70000' },
      ),
    (err: unknown) => {
      assert.ok(err instanceof EnvValidationError);
      assert.equal(err.problems.length, 3);
      const names = err.problems.map((p) => p.name).sort();
      assert.deepEqual(names, ['A', 'B', 'C']);
      return true;
    },
  );
});

test('redacts secret values from error messages', () => {
  assert.throws(
    () =>
      loadEnv(
        { TOKEN: { kind: 'integer', secret: true, description: 'secret token' } },
        { TOKEN: 'super-secret-value' },
      ),
    (err: unknown) => {
      assert.ok(err instanceof EnvValidationError);
      assert.ok(!err.message.includes('super-secret-value'));
      assert.ok(err.message.includes('<redacted>'));
      return true;
    },
  );
});

test('rejects empty required strings and empty values without defaults', () => {
  assert.throws(() => loadEnv({ X: { kind: 'string', description: 'x' } }, { X: '   ' }));
  assert.throws(() => loadEnv({ X: { kind: 'string', description: 'x' } }, { X: '' }));
});

test('rejects out-of-range integers and bad enum/url/boolean values', () => {
  assert.throws(() => loadEnv({ N: { kind: 'integer', min: 1, max: 5, description: 'n' } }, { N: '9' }));
  assert.throws(() => loadEnv({ E: { kind: 'enum', values: ['x'] as const, description: 'e' } }, { E: 'y' }));
  assert.throws(() => loadEnv({ U: { kind: 'url', description: 'u' } }, { U: '::nope::' }));
  assert.throws(
    () => loadEnv({ U: { kind: 'url', protocols: ['https:'], description: 'u' } }, { U: 'http://x' }),
  );
  assert.throws(() => loadEnv({ B: { kind: 'boolean', description: 'b' } }, { B: 'maybe' }));
});

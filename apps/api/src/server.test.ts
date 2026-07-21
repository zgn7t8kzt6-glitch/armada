import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createLogger } from '@armada/observability';
import { createApiServer } from './server.js';
import { loadApiEnv } from './env.js';

let server: Server;
let baseUrl: string;

before(async () => {
  const logger = createLogger({ service: 'armada-api-test', sink: () => {} });
  server = createApiServer({ logger, serviceVersion: 'test' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test('GET /health returns ok with service metadata and no sensitive fields', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('x-request-id'));
  const body = (await res.json()) as { status: string; service: string; version: string };
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'armada-api');
  assert.equal(body.version, 'test');
});

test('GET /ready returns ready', async () => {
  const res = await fetch(`${baseUrl}/ready`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'ready');
});

test('unknown routes return 404 with a request id and no stack traces', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; requestId: string };
  assert.equal(body.error, 'not_found');
  assert.ok(body.requestId.length > 0);
});

test('mutating methods are rejected until authorized routes exist', async () => {
  const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
  assert.equal(res.status, 405);
});

test('api env schema applies defaults and rejects bad ports', () => {
  const env = loadApiEnv({});
  assert.equal(env.API_PORT, 3000);
  assert.equal(env.API_HOST, '127.0.0.1');
  assert.equal(env.NODE_ENV, 'development');
  assert.throws(() => loadApiEnv({ API_PORT: '99999' }));
});

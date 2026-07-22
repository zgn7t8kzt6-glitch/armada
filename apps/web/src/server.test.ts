import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger } from '@armada/observability';
import { createWebServer } from './server.js';

/**
 * Integration tests against a stub of the Armada API: the web app is a
 * rendering shell, so the contract under test is "given API responses,
 * produce correct, safe pages and auth flows".
 */

const VALID_TOKEN = 'stub-token-123';

function stubApi(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const authed = req.headers.authorization === `Bearer ${VALID_TOKEN}`;
    const json = (status: number, body: unknown): void => {
      const data = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
      res.end(data);
    };
    if (url.pathname === '/auth/dev/login' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const email = (JSON.parse(raw || '{}') as { email?: string }).email;
        if (email === 'nurse.akron@dev.armada.example') {
          json(200, { token: VALID_TOKEN, user: { id: 'u1' } });
        } else {
          json(401, { error: 'authentication_failed' });
        }
      });
      return;
    }
    if (!authed) {
      json(401, { error: 'unauthorized' });
      return;
    }
    switch (url.pathname) {
      case '/api/v1/me':
        json(200, {
          displayName: 'Synthetic Akron Nurse',
          email: 'nurse.akron@dev.armada.example',
          assignments: [{ role: 'nurse', facilityScope: ['fac-akron'] }],
        });
        return;
      case '/api/v1/work-items':
        json(200, {
          workItems: [
            {
              id: 'wi-1',
              title: 'Authorization for episode ep-akron-1042 expires within 48 hours',
              explanation: 'Denial risk without concurrent review.',
              priority: 'high',
              status: 'open',
              dueAt: '2026-07-21T20:00:00.000Z',
              ownerRole: 'utilization_review',
              facilityId: 'fac-akron',
              requiredAction: 'Complete the concurrent review.',
            },
          ],
        });
        return;
      case '/api/v1/notifications':
        json(200, { notifications: [{ id: 'n1' }, { id: 'n2' }] });
        return;
      case '/api/v1/scorecards/executive-daily':
        json(403, { error: 'forbidden', reasonCodes: ['FACILITY_NOT_ASSIGNED'] });
        return;
      default:
        json(404, { error: 'not_found' });
    }
  });
}

let apiServer: Server;
let webServer: Server;
let webUrl: string;

before(async () => {
  apiServer = stubApi();
  await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiPort = (apiServer.address() as AddressInfo).port;
  webServer = createWebServer({
    logger: createLogger({ service: 'web-test', sink: () => {} }),
    apiBaseUrl: `http://127.0.0.1:${apiPort}`,
    nodeEnv: 'test',
  });
  await new Promise<void>((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  webUrl = `http://127.0.0.1:${(webServer.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => webServer.close(() => r()));
  await new Promise<void>((r) => apiServer.close(() => r()));
});

test('unauthenticated home redirects to sign-in', async () => {
  const res = await fetch(`${webUrl}/`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
});

test('login flow: bad identity re-renders form, good identity sets HttpOnly cookie', async () => {
  const bad = await fetch(`${webUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=wrong%40dev.armada.example',
  });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Sign-in failed/);

  const good = await fetch(`${webUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=nurse.akron%40dev.armada.example',
    redirect: 'manual',
  });
  assert.equal(good.status, 303);
  const cookie = good.headers.get('set-cookie') ?? '';
  assert.match(cookie, /armada_token=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('authenticated home renders role, work items, and notification count', async () => {
  const res = await fetch(`${webUrl}/`, {
    headers: { cookie: `armada_token=${VALID_TOKEN}` },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Synthetic Akron Nurse/);
  assert.match(html, /ep-akron-1042/);
  assert.match(html, /Next action: Complete the concurrent review\./);
  assert.match(html, /<div class="n">2<\/div><div class="l">notification\(s\)<\/div>/);
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('API 403 renders an honest role message, not a broken page', async () => {
  const res = await fetch(`${webUrl}/scorecard`, {
    headers: { cookie: `armada_token=${VALID_TOKEN}` },
  });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /not available for your role/);
});

test('stale token clears the cookie and returns to sign-in', async () => {
  const res = await fetch(`${webUrl}/work`, {
    headers: { cookie: 'armada_token=expired-token' },
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
  assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('unreachable API degrades to an honest downtime page', async () => {
  const island = createWebServer({
    logger: createLogger({ service: 'web-test-2', sink: () => {} }),
    apiBaseUrl: 'http://127.0.0.1:1',
    nodeEnv: 'test',
  });
  await new Promise<void>((resolve) => island.listen(0, '127.0.0.1', resolve));
  const port = (island.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { cookie: `armada_token=${VALID_TOKEN}` },
    });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /downtime procedures/);
  } finally {
    await new Promise<void>((r) => island.close(() => r()));
  }
});

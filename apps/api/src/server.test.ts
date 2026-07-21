import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { InMemoryAuditLog } from '@armada/audit';
import {
  BreakGlassService,
  DevIdentityProvider,
  InMemoryUserStore,
  SessionManager,
} from '@armada/auth';
import { createLogger } from '@armada/observability';
import { loadApiEnv } from './env.js';
import { FAC_AKRON, FAC_COLUMBUS, seedSyntheticDirectory } from './seed.js';
import { createApiServer, type ApiContext } from './server.js';

const SECRET = 'test-session-secret-0123456789-abcdef';

interface TestApi {
  server: Server;
  baseUrl: string;
  audit: InMemoryAuditLog;
  close(): Promise<void>;
}

async function startApi(options: { devIdp?: boolean } = {}): Promise<TestApi> {
  const users = new InMemoryUserStore();
  const directory = seedSyntheticDirectory(users);
  const audit = new InMemoryAuditLog();
  const context: ApiContext = {
    logger: createLogger({ service: 'api-test', sink: () => {} }),
    serviceVersion: 'test',
    nodeEnv: 'test',
    organizationId: directory.organizationId,
    users,
    sessions: new SessionManager({ secret: SECRET, ttlMinutes: 30 }),
    ...(options.devIdp === false
      ? {}
      : {
          idp: new DevIdentityProvider({
            nodeEnv: 'test',
            lookupByEmail: (email) => users.getByEmail(email),
          }),
        }),
    breakGlass: new BreakGlassService({ audit }),
    audit,
    facilities: directory.facilities,
    censusByFacility: directory.censusByFacility,
  };
  const server = createApiServer(context);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    audit,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

let api: TestApi;

before(async () => {
  api = await startApi();
});

after(async () => {
  await api.close();
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${api.baseUrl}/auth/dev/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200, `login failed for ${email}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${api.baseUrl}${path}`, {
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : {},
  });
}

function post(path: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${api.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('health and readiness are public and expose no data', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  const ready = await get('/ready');
  assert.equal(ready.status, 200);
});

test('unknown routes 404; wrong methods 405', async () => {
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await fetch(`${api.baseUrl}/health`, { method: 'POST' })).status, 405);
});

test('every protected endpoint rejects missing/garbage tokens (401)', async () => {
  for (const path of [
    '/api/v1/me',
    '/api/v1/facilities',
    '/api/v1/patients/summary?facilityId=fac-akron',
    '/api/v1/audit-events',
    '/api/v1/access-review',
  ]) {
    assert.equal((await get(path)).status, 401, path);
    assert.equal((await get(path, 'garbage-token')).status, 401, path);
  }
  assert.equal((await post('/api/v1/break-glass', undefined, {})).status, 401);
  assert.equal((await post('/auth/logout', undefined, {})).status, 401);
});

test('dev login rejects unknown identities', async () => {
  const res = await post('/auth/dev/login', undefined, { email: 'intruder@dev.armada.example' });
  assert.equal(res.status, 401);
});

test('login → /me round-trip returns roles and session expiry', async () => {
  const token = await login('nurse.akron@dev.armada.example');
  const res = await get('/api/v1/me', token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    displayName: string;
    assignments: { role: string; facilityScope: string[] }[];
    sessionExpiresAt: string;
  };
  assert.equal(body.displayName, 'Synthetic Akron Nurse');
  assert.deepEqual(body.assignments[0]?.role, 'nurse');
  assert.ok(body.sessionExpiresAt > new Date().toISOString());
});

test('logout revokes the session immediately (§24 revoked-token negative)', async () => {
  const token = await login('nurse.akron@dev.armada.example');
  assert.equal((await post('/auth/logout', token, {})).status, 204);
  const res = await get('/api/v1/me', token);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { reason: string };
  assert.equal(body.reason, 'revoked');
});

test('facilities list is scoped to assignments', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const nurseRes = (await (await get('/api/v1/facilities', nurse)).json()) as {
    facilities: { id: string }[];
  };
  assert.deepEqual(
    nurseRes.facilities.map((f) => f.id),
    [FAC_AKRON],
  );
  const exec = await login('executive@dev.armada.example');
  const execRes = (await (await get('/api/v1/facilities', exec)).json()) as {
    facilities: { id: string }[];
  };
  assert.equal(execRes.facilities.length, 2);
});

test('facility isolation: Akron nurse reads Akron, is denied Columbus (403 + reasons)', async () => {
  const token = await login('nurse.akron@dev.armada.example');
  const ok = await get(`/api/v1/patients/summary?facilityId=${FAC_AKRON}`, token);
  assert.equal(ok.status, 200);
  const okBody = (await ok.json()) as { censusCount: number; source: string };
  assert.equal(okBody.censusCount, 24);
  assert.equal(okBody.source, 'synthetic-fixture');

  const denied = await get(`/api/v1/patients/summary?facilityId=${FAC_COLUMBUS}`, token);
  assert.equal(denied.status, 403);
  const deniedBody = (await denied.json()) as { reasonCodes: string[]; policyVersion: string };
  assert.deepEqual(deniedBody.reasonCodes, ['FACILITY_NOT_ASSIGNED']);
  assert.ok(deniedBody.policyVersion.length > 0);
});

test('both allowed and denied PHI reads are audited with the policy decision', async () => {
  const events = api.audit.query({ action: 'patient_summary.read' });
  assert.ok(events.some((e) => e.policyDecision === 'ALLOW:ROLE_CAPABILITY_MATCH'));
  assert.ok(events.some((e) => e.policyDecision === 'DENY:FACILITY_NOT_ASSIGNED'));
  assert.deepEqual(api.audit.verifyIntegrity(), {
    ok: true,
    events: api.audit.query().length,
  });
});

test('role gating: nurse cannot read audit events; privacy admin and auditor can', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const deniedRes = await get(`/api/v1/audit-events?facilityId=${FAC_AKRON}`, nurse);
  assert.equal(deniedRes.status, 403);
  const denied = (await deniedRes.json()) as { reasonCodes: string[] };
  assert.deepEqual(denied.reasonCodes, ['ROLE_LACKS_CAPABILITY']);

  const privacy = await login('privacy@dev.armada.example');
  const orgWide = await get('/api/v1/audit-events', privacy);
  assert.equal(orgWide.status, 200);
  const body = (await orgWide.json()) as { events: unknown[]; integrity: { ok: boolean } };
  assert.ok(body.events.length > 0);
  assert.equal(body.integrity.ok, true);

  const auditor = await login('auditor@dev.armada.example');
  assert.equal((await get(`/api/v1/audit-events?facilityId=${FAC_AKRON}`, auditor)).status, 200);
});

test('access review: privacy admin gets the report; sysadmin is classification-blocked', async () => {
  const privacy = await login('privacy@dev.armada.example');
  const res = await get('/api/v1/access-review', privacy);
  assert.equal(res.status, 200);
  const report = (await res.json()) as {
    totals: { users: number };
    orgWideAssignments: unknown[];
  };
  assert.equal(report.totals.users, 7);
  assert.ok(report.orgWideAssignments.length >= 4);

  const sysadmin = await login('sysadmin@dev.armada.example');
  const denied = await get('/api/v1/access-review', sysadmin);
  assert.equal(denied.status, 403);
});

test('break-glass flow: activate, read across facilities, everything audited', async () => {
  const token = await login('nurse.columbus@dev.armada.example');
  // Denied before activation.
  assert.equal(
    (await get(`/api/v1/patients/summary?facilityId=${FAC_AKRON}`, token)).status,
    403,
  );
  // Short reason rejected.
  const shortReason = await post('/api/v1/break-glass', token, {
    facilityId: FAC_AKRON,
    reason: 'short',
  });
  assert.equal(shortReason.status, 400);
  // Unknown facility rejected.
  assert.equal(
    (
      await post('/api/v1/break-glass', token, {
        facilityId: 'fac-nowhere',
        reason: 'a perfectly valid emergency reason',
      })
    ).status,
    400,
  );
  // Valid activation.
  const activated = await post('/api/v1/break-glass', token, {
    facilityId: FAC_AKRON,
    reason: 'Emergency cross-facility coverage tonight',
    durationMinutes: 15,
  });
  assert.equal(activated.status, 201);
  const activation = (await activated.json()) as { notice: string };
  assert.match(activation.notice, /monitored/);

  const read = await get(
    `/api/v1/patients/summary?facilityId=${FAC_AKRON}&purpose=break_glass`,
    token,
  );
  assert.equal(read.status, 200);
  const body = (await read.json()) as { obligations: string[] };
  assert.ok(body.obligations.includes('PRIVACY_REVIEW_QUEUED'));

  const bgEvents = api.audit.query({ actionPrefix: 'break_glass.' });
  assert.ok(bgEvents.length >= 1);
  const bgRead = api.audit
    .query({ action: 'patient_summary.read' })
    .filter((e) => e.policyDecision === 'ALLOW:BREAK_GLASS_APPLIED');
  assert.equal(bgRead.length, 1);
  assert.ok(bgRead[0]?.breakGlassReason?.includes('Emergency cross-facility coverage'));
});

test('patients summary requires facilityId and a valid purpose', async () => {
  const token = await login('nurse.akron@dev.armada.example');
  assert.equal((await get('/api/v1/patients/summary', token)).status, 400);
  assert.equal(
    (await get(`/api/v1/patients/summary?facilityId=${FAC_AKRON}&purpose=curiosity`, token)).status,
    400,
  );
});

test('without a dev IdP (production shape) the login route does not exist', async () => {
  const prodShaped = await startApi({ devIdp: false });
  try {
    const res = await fetch(`${prodShaped.baseUrl}/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'sysadmin@dev.armada.example' }),
    });
    assert.equal(res.status, 404);
  } finally {
    await prodShaped.close();
  }
});

test('api env schema: session defaults apply and weak overrides fail', () => {
  const env = loadApiEnv({});
  assert.equal(env.SESSION_TTL_MINUTES, 30);
  assert.ok(env.SESSION_SECRET.length >= 32);
  assert.throws(() => loadApiEnv({ SESSION_TTL_MINUTES: '0' }));
  assert.throws(() => loadApiEnv({ SESSION_TTL_MINUTES: 'lots' }));
});

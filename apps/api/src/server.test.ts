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
import { collaborateMdMappingRegistrations, createMockCollaborateMdConnector } from '@armada/connector-collaboratemd';
import { createMockKipuConnector, kipuMappingRegistrations } from '@armada/connector-kipu';
import { createMockSalesforceConnector, salesforceMappingRegistrations } from '@armada/connector-salesforce';
import { ExcellenceContentService, seedExcellenceContent } from '@armada/excellence';
import { IdentityService, seedIdentityScenarios } from '@armada/identity';
import {
  IngestionPipeline,
  InMemoryIngestedRecordStore,
  MappingRegistry,
} from '@armada/integrations-core';
import { InMemoryNotifier, WorkItemService, seedWorkItems } from '@armada/work';
import { createLogger } from '@armada/observability';
import { ComplianceService, seedComplianceRequirements } from '@armada/compliance';
import { LineupService } from '@armada/lineup';
import { loadApiEnv } from './env.js';
import { createLineupFacts } from './lineupSetup.js';
import { wireMetrics } from './metricsSetup.js';
import { FAC_AKRON, FAC_COLUMBUS, seedSyntheticDirectory } from './seed.js';
import { createApiServer, type ApiContext } from './server.js';

const SECRET = 'test-session-secret-0123456789-abcdef';

interface TestApi {
  server: Server;
  baseUrl: string;
  audit: InMemoryAuditLog;
  work: WorkItemService;
  close(): Promise<void>;
}

async function startApi(options: { devIdp?: boolean } = {}): Promise<TestApi> {
  const users = new InMemoryUserStore();
  const directory = seedSyntheticDirectory(users);
  const audit = new InMemoryAuditLog();
  const excellence = new ExcellenceContentService();
  const author = users.getByEmail('quality@dev.armada.example');
  const approver = users.getByEmail('executive@dev.armada.example');
  assert.ok(author && approver);
  seedExcellenceContent(excellence, {
    authorId: author.id,
    approverId: approver.id,
    approverRole: 'executive',
  });
  const mappings = new MappingRegistry();
  for (const registration of [
    ...kipuMappingRegistrations(),
    ...salesforceMappingRegistrations(),
    ...collaborateMdMappingRegistrations(),
  ]) {
    mappings.register(registration);
  }
  const ingestStore = new InMemoryIngestedRecordStore();
  const pipeline = new IngestionPipeline({ audit, store: ingestStore, mappings });
  const connectors = [
    createMockKipuConnector({ facilityIds: [FAC_AKRON, FAC_COLUMBUS] }),
    createMockSalesforceConnector(),
    createMockCollaborateMdConnector(),
  ];
  for (const connector of connectors) {
    await pipeline.run(connector);
  }
  const identity = new IdentityService({ audit });
  seedIdentityScenarios(identity, { akron: FAC_AKRON, columbus: FAC_COLUMBUS });
  const notifier = new InMemoryNotifier();
  const work = new WorkItemService({ audit, notifier });
  seedWorkItems(work, {
    organizationId: directory.organizationId,
    akronFacilityId: FAC_AKRON,
    columbusFacilityId: FAC_COLUMBUS,
    createdBy: author.id,
  });
  const metrics = wireMetrics({
    audit,
    work,
    ingestStore,
    facilities: directory.facilities,
    seedActors: { definedBy: author.id, approvedBy: approver.id },
  });
  const lineup = new LineupService({
    audit,
    facts: createLineupFacts({ excellence, work, ingestStore }),
  });
  const compliance = new ComplianceService({ audit });
  seedComplianceRequirements(compliance, author.id);
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
    excellence,
    work,
    notifier,
    identity,
    metrics,
    lineup,
    compliance,
    integrations: { pipeline, connectors, store: ingestStore },
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
    work,
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
  assert.equal(report.totals.users, 10);
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

test('excellence library: every role reads gold standards, role cards, constitution', async () => {
  const bht = await login('bht.akron@dev.armada.example');
  const standards = await get('/api/v1/excellence/gold-standards', bht);
  assert.equal(standards.status, 200);
  const list = (await standards.json()) as { goldStandards: { title: string }[] };
  assert.equal(list.goldStandards.length, 3);

  const card = await get('/api/v1/excellence/role-cards/bht_recovery_support', bht);
  assert.equal(card.status, 200);
  const cardBody = (await card.json()) as { roleCard: { title: string } };
  assert.match(cardBody.roleCard.title, /BHT/);

  assert.equal((await get('/api/v1/excellence/role-cards/provider', bht)).status, 404);

  const constitution = await get('/api/v1/excellence/constitution', bht);
  assert.equal(constitution.status, 200);
  const docs = (await constitution.json()) as { documents: unknown[] };
  assert.equal(docs.documents.length, 2);
  assert.equal((await get('/api/v1/excellence/policies', bht)).status, 200);
});

test('excellence search finds the weekend AMA standard', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const res = await get('/api/v1/excellence/search?q=weekend%20AMA', nurse);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: { title: string; snippet: string }[] };
  assert.equal(body.results[0]?.title, 'Safe and Ready Weekend');
  assert.ok(body.results[0]!.snippet.length > 0);
});

test('printable view is standalone HTML with the uncontrolled-copy notice', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const listRes = await get('/api/v1/excellence/gold-standards', nurse);
  const { goldStandards } = (await listRes.json()) as { goldStandards: { contentId: string }[] };
  const contentId = goldStandards[0]?.contentId;
  assert.ok(contentId);
  const res = await get(`/api/v1/excellence/content/${contentId}/print`, nurse);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Printed copies are uncontrolled/);
  assert.match(html, /Approved by role executive/);
});

test('authoring is write-gated: nurse denied, quality lead full workflow to publish', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const draftBody = {
    title: 'Quiet Environment at Night',
    body: {
      kind: 'constitution_document',
      docType: 'service_values',
      text: 'Night shifts protect rest: low voices, dim lights, no avoidable noise.',
    },
  };
  const deniedCreate = await post('/api/v1/excellence/content', nurse, draftBody);
  assert.equal(deniedCreate.status, 403);
  const denied = (await deniedCreate.json()) as { reasonCodes: string[] };
  assert.deepEqual(denied.reasonCodes, ['ROLE_LACKS_CAPABILITY']);

  const quality = await login('quality@dev.armada.example');
  const created = await post('/api/v1/excellence/content', quality, draftBody);
  assert.equal(created.status, 201);
  const { contentId } = (await created.json()) as { contentId: string };

  // Not visible in the published library while draft.
  assert.equal((await get(`/api/v1/excellence/content/${contentId}`, quality)).status, 404);

  const edited = await post(`/api/v1/excellence/content/${contentId}/edit`, quality, {
    title: 'Quiet Environment at Night (v1)',
  });
  assert.equal(edited.status, 200);

  assert.equal(
    (await post(`/api/v1/excellence/content/${contentId}/submit`, quality, {})).status,
    200,
  );

  // Author cannot approve their own content (separation of duties).
  const selfApprove = await post(`/api/v1/excellence/content/${contentId}/approve`, quality, {});
  assert.equal(selfApprove.status, 400);
  assert.match(((await selfApprove.json()) as { message: string }).message, /separation of duties/);

  const exec = await login('executive@dev.armada.example');
  assert.equal(
    (await post(`/api/v1/excellence/content/${contentId}/approve`, exec, { note: 'ok' })).status,
    200,
  );
  assert.equal(
    (await post(`/api/v1/excellence/content/${contentId}/publish`, exec, {})).status,
    200,
  );

  const detail = await get(`/api/v1/excellence/content/${contentId}`, nurse);
  assert.equal(detail.status, 200);
  const detailBody = (await detail.json()) as { content: { status: string; title: string } };
  assert.equal(detailBody.content.status, 'published');
  assert.equal(detailBody.content.title, 'Quiet Environment at Night (v1)');

  // The whole workflow left an audit trail.
  for (const action of [
    'excellence_content.created',
    'excellence_content.submitted',
    'excellence_content.approved',
    'excellence_content.published',
  ]) {
    assert.ok(api.audit.query({ action }).length >= 1, action);
  }
});

test('approve without an approver role is rejected even with write capability', async () => {
  const quality = await login('quality@dev.armada.example');
  const created = await post('/api/v1/excellence/content', quality, {
    title: 'Draft for HR approval test',
    body: {
      kind: 'constitution_document',
      docType: 'employee_promise',
      text: 'We invest in your growth and never waste your effort.',
    },
  });
  const { contentId } = (await created.json()) as { contentId: string };
  await post(`/api/v1/excellence/content/${contentId}/submit`, quality, {});

  // sysadmin lacks excellence write capability entirely → 403 from policy.
  const sysadmin = await login('sysadmin@dev.armada.example');
  const res = await post(`/api/v1/excellence/content/${contentId}/approve`, sysadmin, {});
  assert.equal(res.status, 403);
});

test('work queue: facility isolation and role-based visibility', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  const akron = await get(`/api/v1/work-items?facilityId=${FAC_AKRON}`, nurse);
  assert.equal(akron.status, 200);
  const akronItems = (await akron.json()) as { workItems: { facilityId: string; priority: string }[] };
  assert.ok(akronItems.workItems.length >= 2);
  assert.ok(akronItems.workItems.every((i) => i.facilityId === FAC_AKRON));

  // Facility isolation: Akron nurse cannot list the Columbus queue.
  assert.equal((await get(`/api/v1/work-items?facilityId=${FAC_COLUMBUS}`, nurse)).status, 403);

  // Aggregate listing quietly limits to covered facilities.
  const aggregate = await get('/api/v1/work-items', nurse);
  const aggregateItems = (await aggregate.json()) as { workItems: { facilityId: string }[] };
  assert.ok(aggregateItems.workItems.every((i) => i.facilityId === FAC_AKRON));

  // Org-wide executive sees both facilities, sorted by priority then due.
  const exec = await login('executive@dev.armada.example');
  const all = await get('/api/v1/work-items', exec);
  const allItems = (await all.json()) as { workItems: { facilityId: string }[] };
  assert.ok(new Set(allItems.workItems.map((i) => i.facilityId)).size === 2);

  // mine=1 narrows to the caller's role ownership.
  const ur = await login('ur.akron@dev.armada.example');
  const mine = await get('/api/v1/work-items?mine=1', ur);
  const mineItems = (await mine.json()) as { workItems: { type: string }[] };
  assert.ok(mineItems.workItems.some((i) => i.type === 'ur.authorization_expiring'));
  assert.ok(!mineItems.workItems.some((i) => i.type === 'facilities.room_turn'));
});

test('work item lifecycle over HTTP: acknowledge, conflict, resolve, audit', async () => {
  const ur = await login('ur.akron@dev.armada.example');
  const list = await get(`/api/v1/work-items?facilityId=${FAC_AKRON}`, ur);
  const { workItems } = (await list.json()) as {
    workItems: { id: string; type: string; version: number; explanation: string }[];
  };
  const item = workItems.find((i) => i.type === 'ur.authorization_expiring');
  assert.ok(item);
  assert.ok(item.explanation.length > 0, 'every alert explains itself');

  const acked = await post(`/api/v1/work-items/${item.id}/acknowledge`, ur, {
    expectedVersion: item.version,
  });
  assert.equal(acked.status, 200);
  const ackedItem = (await acked.json()) as { workItem: { status: string; ownerUserId: string } };
  assert.equal(ackedItem.workItem.status, 'acknowledged');

  // Stale version → 409.
  const stale = await post(`/api/v1/work-items/${item.id}/resolve`, ur, {
    code: 'completed',
    expectedVersion: item.version,
  });
  assert.equal(stale.status, 409);

  // Exception code without a note → 400.
  const noNote = await post(`/api/v1/work-items/${item.id}/resolve`, ur, {
    code: 'unable_to_complete',
  });
  assert.equal(noNote.status, 400);

  const resolved = await post(`/api/v1/work-items/${item.id}/resolve`, ur, {
    code: 'completed',
    note: 'Concurrent review submitted.',
  });
  assert.equal(resolved.status, 200);
  assert.ok(api.audit.query({ action: 'work_item.acknowledged' }).length >= 1);
  assert.ok(api.audit.query({ action: 'work_item.resolved' }).length >= 1);

  // Unknown item → 404.
  assert.equal((await post('/api/v1/work-items/wi-nope/acknowledge', ur, {})).status, 404);
});

test('write gating: executive can read queues but cannot resolve or create', async () => {
  const exec = await login('executive@dev.armada.example');
  const list = await get(`/api/v1/work-items?facilityId=${FAC_COLUMBUS}`, exec);
  const { workItems } = (await list.json()) as { workItems: { id: string }[] };
  const target = workItems[0];
  assert.ok(target);
  const denied = await post(`/api/v1/work-items/${target.id}/resolve`, exec, { code: 'completed' });
  assert.equal(denied.status, 403);
  const deniedCreate = await post('/api/v1/work-items', exec, { facilityId: FAC_COLUMBUS });
  assert.equal(deniedCreate.status, 403);
});

test('creating a work item requires explanation, source facts, and valid shape', async () => {
  const quality = await login('quality@dev.armada.example');
  const missing = await post('/api/v1/work-items', quality, {
    type: 'quality.audit_prep',
    title: 'Prepare tracer documents for room rm-akron-3',
    facilityId: FAC_AKRON,
    subjectType: 'room',
    subjectId: 'rm-akron-3',
    priority: 'medium',
    dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    ownerRole: 'quality_risk',
    sourceFacts: [],
    requiredAction: 'Assemble the tracer binder.',
    explanation: 'Survey readiness requires tracer documents staged in advance.',
  });
  assert.equal(missing.status, 400);
  assert.match(((await missing.json()) as { message: string }).message, /source fact/);

  const created = await post('/api/v1/work-items', quality, {
    type: 'quality.audit_prep',
    title: 'Prepare tracer documents for room rm-akron-3',
    facilityId: FAC_AKRON,
    subjectType: 'room',
    subjectId: 'rm-akron-3',
    priority: 'medium',
    dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    ownerRole: 'quality_risk',
    sourceFacts: [
      {
        label: 'Audit calendar entry',
        value: 'tracer scheduled (synthetic)',
        sourceSystem: 'synthetic-fixture',
        sourceTimestamp: new Date().toISOString(),
      },
    ],
    requiredAction: 'Assemble the tracer binder.',
    explanation: 'Survey readiness requires tracer documents staged in advance.',
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { workItem: { escalationLevel: number; status: string } };
  assert.equal(body.workItem.status, 'open');
  assert.equal(body.workItem.escalationLevel, 0);
});

test('manual escalation and PHI-free notifications reach the right roles', async () => {
  const ur = await login('ur.akron@dev.armada.example');
  const created = await post('/api/v1/work-items', ur, {
    type: 'ur.peer_to_peer_deadline',
    title: 'Peer-to-peer deadline approaching for episode ep-akron-2001',
    facilityId: FAC_AKRON,
    subjectType: 'treatment_episode',
    subjectId: 'ep-akron-2001',
    priority: 'critical',
    dueAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    ownerRole: 'utilization_review',
    backupRole: 'clinical_director',
    sourceFacts: [
      {
        label: 'Peer-to-peer deadline',
        value: 'tomorrow 12:00 (synthetic)',
        sourceSystem: 'synthetic-fixture',
        sourceTimestamp: new Date().toISOString(),
      },
    ],
    requiredAction: 'Schedule the peer-to-peer call with the payer medical director.',
    explanation: 'Missing the peer-to-peer window forfeits the appeal path for continued stay.',
  });
  assert.equal(created.status, 201);
  const { workItem } = (await created.json()) as { workItem: { id: string } };

  const escalated = await post(`/api/v1/work-items/${workItem.id}/escalate`, ur, {
    note: 'Payer unresponsive after two attempts',
  });
  assert.equal(escalated.status, 200);
  const escBody = (await escalated.json()) as {
    workItem: { escalationLevel: number; escalations: { notifiedRole: string }[] };
  };
  assert.equal(escBody.workItem.escalationLevel, 1);

  const notifications = await get('/api/v1/notifications', ur);
  assert.equal(notifications.status, 200);
  const { notifications: list } = (await notifications.json()) as {
    notifications: Record<string, unknown>[];
  };
  assert.ok(list.length >= 1);
  const serialized = JSON.stringify(list);
  assert.ok(!serialized.includes('Peer-to-peer deadline approaching'), 'no titles in notifications');
  assert.ok(!serialized.includes('forfeits the appeal path'), 'no explanations in notifications');
  assert.ok(serialized.includes('ur.peer_to_peer_deadline'), 'type is present');

  // The nurse (different role, same facility) does not see UR notifications.
  const nurse = await login('nurse.akron@dev.armada.example');
  const nurseView = (await (await get('/api/v1/notifications', nurse)).json()) as {
    notifications: { recipientRole: string }[];
  };
  assert.ok(nurseView.notifications.every((n) => n.recipientRole === 'nurse'));
});

test('integrations health: sysadmin sees mock connectors with run summaries', async () => {
  const sysadmin = await login('sysadmin@dev.armada.example');
  const res = await get('/api/v1/integrations/health', sysadmin);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    connectors: {
      name: string;
      mock: boolean;
      supportsWrite: boolean;
      health: { healthy: boolean };
      lastRun: { status: string; counts: { read: number; created: number } } | null;
      deadLetterCount: number;
      quarantineCount: number;
      cursor: string | null;
    }[];
    recordCountsByEntityType: Record<string, number>;
  };
  assert.deepEqual(
    body.connectors.map((c) => c.name).sort(),
    ['mock-collaboratemd', 'mock-kipu', 'mock-salesforce'],
  );
  for (const connector of body.connectors) {
    assert.equal(connector.mock, true);
    assert.equal(connector.supportsWrite, false, 'writes stay disabled');
    assert.equal(connector.health.healthy, true);
    assert.equal(connector.lastRun?.status, 'succeeded');
    assert.ok(connector.lastRun !== null && connector.lastRun.counts.read > 0);
    assert.equal(connector.deadLetterCount, 0);
    assert.equal(connector.quarantineCount, 0);
    assert.ok(connector.cursor !== null, 'cursor checkpoint persisted');
  }
  // Provenance-bearing records landed in the canonical store.
  assert.ok((body.recordCountsByEntityType['census_snapshot'] ?? 0) > 0);
  assert.ok((body.recordCountsByEntityType['claim_summary'] ?? 0) > 0);
});

test('integrations health is admin-gated: nurse and executive are denied', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  assert.equal((await get('/api/v1/integrations/health', nurse)).status, 403);
  const exec = await login('executive@dev.armada.example');
  assert.equal((await get('/api/v1/integrations/health', exec)).status, 403);
});

test('ingestion audit trail exists and is PHI-free', async () => {
  const runs = api.audit.query({ action: 'ingestion.run_completed' });
  assert.ok(runs.length >= 3);
  for (const event of runs) {
    assert.match(event.summary ?? '', /read=\d+ created=\d+/);
    assert.ok(!JSON.stringify(event).includes('"payload"'));
  }
});

test('reconciliation console: gated read with candidates side by side', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  assert.equal((await get('/api/v1/reconciliation/issues', nurse)).status, 403);

  const privacy = await login('privacy@dev.armada.example');
  const res = await get('/api/v1/reconciliation/issues?status=open', privacy);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    issues: {
      id: string;
      reason: string;
      candidates: { personId: string; matchedFields: string[]; conflictingFields: string[]; signals: Record<string, string> }[];
    }[];
  };
  assert.equal(body.issues.length, 2);
  const multi = body.issues.find((i) => i.reason === 'multiple_candidates');
  const conflict = body.issues.find((i) => i.reason === 'conflicting_identifiers');
  assert.ok(multi && conflict);
  assert.equal(multi.candidates.length, 2);
  assert.ok(multi.candidates[0]!.matchedFields.includes('legalName'));
  assert.ok(Object.keys(multi.candidates[0]!.signals).length > 0, 'side-by-side signals');
  assert.ok(conflict.candidates[0]!.conflictingFields.includes('dateOfBirth'));
  // Sensitive read is audited.
  assert.ok(api.audit.query({ action: 'reconciliation_issues.read' }).length >= 1);
});

test('read-only auditor can view the queue but cannot resolve', async () => {
  const auditor = await login('auditor@dev.armada.example');
  const list = await get('/api/v1/reconciliation/issues', auditor);
  assert.equal(list.status, 200);
  const { issues } = (await list.json()) as { issues: { id: string }[] };
  const denied = await post(`/api/v1/reconciliation/issues/${issues[0]!.id}/resolve`, auditor, {
    action: 'defer',
  });
  assert.equal(denied.status, 403);
});

test('resolving an issue links the record and survives as a crosswalk', async () => {
  const privacy = await login('privacy@dev.armada.example');
  const list = await get('/api/v1/reconciliation/issues?status=open', privacy);
  const { issues } = (await list.json()) as {
    issues: { id: string; reason: string; candidates: { personId: string }[] }[];
  };
  const multi = issues.find((i) => i.reason === 'multiple_candidates');
  assert.ok(multi);

  // Bad action and unknown issue are rejected cleanly.
  assert.equal(
    (await post(`/api/v1/reconciliation/issues/${multi.id}/resolve`, privacy, { action: 'merge' }))
      .status,
    400,
  );
  assert.equal(
    (await post('/api/v1/reconciliation/issues/nope/resolve', privacy, { action: 'defer' })).status,
    404,
  );

  const resolved = await post(`/api/v1/reconciliation/issues/${multi.id}/resolve`, privacy, {
    action: 'link',
    personId: multi.candidates[0]!.personId,
    note: 'Verified against payer portal (synthetic).',
  });
  assert.equal(resolved.status, 200);
  const { issue } = (await resolved.json()) as { issue: { status: string } };
  assert.equal(issue.status, 'resolved');
  assert.ok(api.audit.query({ action: 'identity.review_resolved' }).length >= 1);
});

test('merge lifecycle over HTTP: dual confirmation enforced, unmerge audited', async () => {
  const privacy = await login('privacy@dev.armada.example');
  const list = await get('/api/v1/reconciliation/issues', privacy);
  const { issues } = (await list.json()) as {
    issues: { reason: string; candidates: { personId: string }[] }[];
  };
  const multi = issues.find((i) => i.reason === 'multiple_candidates');
  assert.ok(multi && multi.candidates.length >= 2);
  const [a, b] = [multi.candidates[0]!.personId, multi.candidates[1]!.personId];

  const requested = await post('/api/v1/identity/merges', privacy, {
    primaryPersonId: a,
    duplicatePersonId: b,
    reason: 'Duplicate registrations for the same synthetic person',
  });
  assert.equal(requested.status, 201);
  const { merge } = (await requested.json()) as { merge: { id: string } };

  // Requester cannot self-confirm.
  const selfConfirm = await post(`/api/v1/identity/merges/${merge.id}/confirm`, privacy, {});
  assert.equal(selfConfirm.status, 400);
  assert.match(((await selfConfirm.json()) as { message: string }).message, /second reviewer/);

  const quality = await login('quality@dev.armada.example');
  const confirmed = await post(`/api/v1/identity/merges/${merge.id}/confirm`, quality, {});
  assert.equal(confirmed.status, 200);
  const confirmedBody = (await confirmed.json()) as { merge: { status: string } };
  assert.equal(confirmedBody.merge.status, 'executed');

  const unmerged = await post(`/api/v1/identity/merges/${merge.id}/unmerge`, quality, {
    reason: 'Testing full reversal path end to end',
  });
  assert.equal(unmerged.status, 200);
  const unmergedBody = (await unmerged.json()) as { merge: { status: string } };
  assert.equal(unmergedBody.merge.status, 'unmerged');

  const merges = await get('/api/v1/identity/merges', privacy);
  const mergesBody = (await merges.json()) as { merges: { status: string }[] };
  assert.ok(mergesBody.merges.some((m) => m.status === 'unmerged'));
  for (const action of ['identity.merge_requested', 'identity.merge_confirmed', 'identity.unmerged']) {
    assert.ok(api.audit.query({ action }).length >= 1, action);
  }
});

test('executive scorecard: live values, definitions, provenance, honest no_data', async () => {
  const exec = await login('executive@dev.armada.example');
  const res = await get('/api/v1/scorecards/executive-daily', exec);
  assert.equal(res.status, 200);
  const view = (await res.json()) as {
    generatedAt: string;
    sections: {
      title: string;
      entries: {
        metricId: string;
        status: string;
        observation: { value: number; provenance: { sourceSystem: string; asOf: string }[] } | null;
        definition: { businessQuestion: string; formula: string; ownerRole: string; version: number };
      }[];
    }[];
  };
  const entries = view.sections.flatMap((s) => s.entries);
  const occupancy = entries.find((e) => e.metricId === 'census.occupancy_rate');
  assert.ok(occupancy !== undefined && occupancy.observation !== null, 'occupancy computed');
  assert.equal(occupancy.observation.provenance[0]?.sourceSystem, 'mock-kipu');
  assert.ok(occupancy.definition.businessQuestion.length > 0, 'definition tooltip present');

  const denial = entries.find((e) => e.metricId === 'revenue.denial_rate');
  assert.ok(denial !== undefined && denial.observation !== null, 'denial rate computed');
  assert.ok(denial.observation.value > 0);

  const overdue = entries.find((e) => e.metricId === 'work.overdue_items');
  assert.ok(overdue !== undefined && overdue.observation !== null);
  assert.ok(overdue.observation.value >= 1, 'seeded overdue claim item counted');

  const ama = entries.find((e) => e.metricId === 'ama.weekend_rate');
  assert.equal(ama?.status, 'no_data', 'unavailable source shown honestly');
  assert.equal(ama?.observation, null);
});

test('scorecard facility isolation and metrics-list gating', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  // Org-wide rollup needs org-wide scope.
  assert.equal((await get('/api/v1/scorecards/executive-daily', nurse)).status, 403);
  // Own facility is fine; the other facility is not.
  assert.equal(
    (await get(`/api/v1/scorecards/executive-daily?facilityId=${FAC_AKRON}`, nurse)).status,
    200,
  );
  assert.equal(
    (await get(`/api/v1/scorecards/executive-daily?facilityId=${FAC_COLUMBUS}`, nurse)).status,
    403,
  );
  // Privacy admin has no census capability → no metrics surface.
  const privacy = await login('privacy@dev.armada.example');
  assert.equal((await get('/api/v1/metrics', privacy)).status, 403);
  assert.equal((await get('/api/v1/scorecards/executive-daily', privacy)).status, 403);

  const exec = await login('executive@dev.armada.example');
  const list = await get('/api/v1/metrics', exec);
  assert.equal(list.status, 200);
  const body = (await list.json()) as { definitions: { id: string }[]; scorecards: { id: string }[] };
  assert.equal(body.definitions.length, 5);
  assert.equal(body.scorecards[0]?.id, 'executive-daily');

  assert.equal((await get('/api/v1/scorecards/nope', exec)).status, 404);
});

test('scorecard CSV export for offline/downtime use', async () => {
  const exec = await login('executive@dev.armada.example');
  const res = await get('/api/v1/scorecards/executive-daily?format=csv', exec);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /metric_id,metric_name,value/);
  assert.match(csv, /census\.occupancy_rate/);
  assert.match(csv, /no_data/);
});

test('daily lineup: generated from live sources, edited, approved, published, printed', async () => {
  const bht = await login('bht.akron@dev.armada.example');
  const res = await get(`/api/v1/lineups/today?facilityId=${FAC_AKRON}`, bht);
  assert.equal(res.status, 200);
  const { lineup } = (await res.json()) as {
    lineup: {
      id: string;
      status: string;
      items: { section: string; body: string; generated: boolean; source?: { sourceSystem: string } }[];
    };
  };
  assert.equal(lineup.status, 'draft');
  const standard = lineup.items.find((i) => i.section === 'gold_standard');
  assert.ok(standard && standard.body.length > 0, 'gold standard from Excellence library');
  const census = lineup.items.find((i) => i.section === 'census');
  assert.equal(census?.source?.sourceSystem, 'mock-kipu');
  const authRisks = lineup.items.find((i) => i.section === 'authorization_risks');
  assert.match(authRisks?.body ?? '', /ep-akron-/, 'UR work item surfaces in lineup');

  // BHT can read but not edit/approve/publish.
  assert.equal(
    (
      await post(`/api/v1/lineups/${lineup.id}/items`, bht, {
        section: 'recognition',
        title: 'Recognition',
        body: 'x',
      })
    ).status,
    403,
  );

  // Facility isolation: Akron UR staff cannot read the Columbus lineup.
  // (nurse.columbus holds an active break-glass grant for Akron from an
  // earlier test, so they are correctly ALLOWED there — use a clean user.)
  const akronUr = await login('ur.akron@dev.armada.example');
  assert.equal((await get(`/api/v1/lineups/today?facilityId=${FAC_COLUMBUS}`, akronUr)).status, 403);

  const quality = await login('quality@dev.armada.example');
  const edited = await post(`/api/v1/lineups/${lineup.id}/items`, quality, {
    section: 'recognition',
    title: 'Recognition',
    body: 'Night team kept a tough weekend calm and safe — thank you.',
  });
  assert.equal(edited.status, 200);
  assert.equal(
    (await post(`/api/v1/lineups/${lineup.id}/items`, quality, { section: 'nope', title: 'x', body: 'y' })).status,
    400,
  );
  // Publish before approval fails.
  assert.equal((await post(`/api/v1/lineups/${lineup.id}/publish`, quality, {})).status, 400);
  assert.equal((await post(`/api/v1/lineups/${lineup.id}/approve`, quality, {})).status, 200);
  const published = await post(`/api/v1/lineups/${lineup.id}/publish`, quality, {});
  assert.equal(published.status, 200);
  const pubBody = (await published.json()) as { lineup: { status: string } };
  assert.equal(pubBody.lineup.status, 'published');

  const print = await get(`/api/v1/lineups/${lineup.id}/print`, bht);
  assert.equal(print.status, 200);
  assert.match(print.headers.get('content-type') ?? '', /text\/html/);
  const html = await print.text();
  assert.match(html, /Daily Lineup — Akron Residential/);
  assert.match(html, /Night team kept a tough weekend calm/);
  for (const action of ['lineup.generated', 'lineup.edited', 'lineup.approved', 'lineup.published']) {
    assert.ok(api.audit.query({ action }).length >= 1, action);
  }
});

test('compliance workspace: requirements, evidence, corrective actions, readiness', async () => {
  const nurse = await login('nurse.akron@dev.armada.example');
  assert.equal((await get('/api/v1/compliance/requirements', nurse)).status, 403);

  const quality = await login('quality@dev.armada.example');
  const reqRes = await get('/api/v1/compliance/requirements', quality);
  assert.equal(reqRes.status, 200);
  const { requirements } = (await reqRes.json()) as {
    requirements: { id: string; authority: string; citation: string }[];
  };
  assert.equal(requirements.length, 4);
  assert.ok(requirements.some((r) => r.citation === 'OAC 5122-29-09'));

  const hipaa = requirements.find((r) => r.authority === 'HIPAA');
  assert.ok(hipaa);
  const evidence = await post('/api/v1/compliance/evidence', quality, {
    requirementId: hipaa.id,
    type: 'audit_event',
    reference: 'audit-log-integrity-check',
    description: 'Hash-chain verification green in CI (synthetic evidence)',
  });
  assert.equal(evidence.status, 201);

  const action = await post('/api/v1/compliance/corrective-actions', quality, {
    findingSummary: 'Mock tracer: two handoffs missing documented escalation path',
    ownerRole: 'nursing_director',
    dueDate: '2026-08-15',
    requirementId: requirements[0]!.id,
  });
  assert.equal(action.status, 201);
  const { correctiveAction } = (await action.json()) as { correctiveAction: { id: string } };

  const readiness = await get('/api/v1/compliance/readiness', quality);
  assert.equal(readiness.status, 200);
  const readinessBody = (await readiness.json()) as {
    readiness: {
      byAuthority: { authority: string; withEvidence: number; highRiskWithoutEvidence: number }[];
      correctiveActions: { open: number };
    };
  };
  const hipaaRow = readinessBody.readiness.byAuthority.find((a) => a.authority === 'HIPAA');
  assert.equal(hipaaRow?.withEvidence, 1);
  const part2Row = readinessBody.readiness.byAuthority.find((a) => a.authority === 'Part2');
  assert.equal(part2Row?.highRiskWithoutEvidence, 1, 'gaps surface honestly');
  assert.equal(readinessBody.readiness.correctiveActions.open, 1);

  // Close requires a real note.
  assert.equal(
    (
      await post(`/api/v1/compliance/corrective-actions/${correctiveAction.id}/close`, quality, {
        closureNote: 'ok',
      })
    ).status,
    400,
  );
  const closed = await post(
    `/api/v1/compliance/corrective-actions/${correctiveAction.id}/close`,
    quality,
    { closureNote: 'Retrained handoff standard work; verified two clean tracers.' },
  );
  assert.equal(closed.status, 200);

  // Executive can read readiness but not write evidence.
  const exec = await login('executive@dev.armada.example');
  assert.equal((await get('/api/v1/compliance/readiness', exec)).status, 200);
  assert.equal(
    (
      await post('/api/v1/compliance/evidence', exec, {
        requirementId: hipaa.id,
        type: 'document',
        reference: 'x',
        description: 'y',
      })
    ).status,
    403,
  );
});

test('api env schema: session defaults apply and weak overrides fail', () => {
  const env = loadApiEnv({});
  assert.equal(env.SESSION_TTL_MINUTES, 30);
  assert.ok(env.SESSION_SECRET.length >= 32);
  assert.throws(() => loadApiEnv({ SESSION_TTL_MINUTES: '0' }));
  assert.throws(() => loadApiEnv({ SESSION_TTL_MINUTES: 'lots' }));
});

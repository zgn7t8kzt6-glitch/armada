import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { renderScorecardCsv } from './export.js';
import { seedMetricDefinitions, EXECUTIVE_SCORECARD_ID } from './seed.js';
import { MetricsService, entryStatus, type DefineMetricInput } from './service.js';
import type { MetricDefinition } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');
const ORG = 'org-armada';

function harness() {
  const audit = new InMemoryAuditLog({ now: NOW });
  return { audit, service: new MetricsService({ audit, now: NOW }) };
}

function baseDefinition(overrides: Partial<DefineMetricInput> = {}): DefineMetricInput {
  return {
    id: 'test.sample_rate',
    name: 'Sample rate',
    businessQuestion: 'Is the sample healthy?',
    ownerRole: 'quality_risk',
    formula: 'good ÷ total × 100',
    numeratorDescription: 'Good samples',
    denominatorDescription: 'All samples',
    inclusionCriteria: ['all synthetic samples'],
    exclusionCriteria: [],
    sourceSystems: ['synthetic-fixture'],
    refreshSchedule: 'on demand',
    expectedLatency: 'minutes',
    unit: 'percent',
    directionality: 'higher_is_better',
    target: 90,
    warningThreshold: 80,
    segmentation: ['organization', 'facility'],
    createdBy: 'user-definer',
    ...overrides,
  };
}

function activeMetric(service: MetricsService, overrides: Partial<DefineMetricInput> = {}) {
  const definition = service.define(baseDefinition(overrides));
  return service.approve(definition.id, { approvedBy: 'user-approver', approverRole: 'executive' });
}

test('definition completeness is enforced (§19 fields)', () => {
  const { service } = harness();
  assert.throws(() => service.define(baseDefinition({ id: 'BadId' })), /dotted lowercase/);
  assert.throws(() => service.define(baseDefinition({ businessQuestion: ' ' })), /businessQuestion/);
  assert.throws(() => service.define(baseDefinition({ formula: '' })), /formula/);
  assert.throws(() => service.define(baseDefinition({ sourceSystems: [] })), /source system/);
  assert.throws(() => service.define(baseDefinition({ segmentation: [] })), /segmentation/);
  assert.throws(() => service.define(baseDefinition({ ownerRole: 'wizard' as never })), /owner role/);
  service.define(baseDefinition());
  assert.throws(() => service.define(baseDefinition()), /already defined/);
});

test('approval: approver role required, definer cannot self-approve, audited', () => {
  const { service, audit } = harness();
  const definition = service.define(baseDefinition());
  assert.throws(
    () => service.approve(definition.id, { approvedBy: 'x', approverRole: 'nurse' }),
    /not a metric approver/,
  );
  assert.throws(
    () => service.approve(definition.id, { approvedBy: 'user-definer', approverRole: 'executive' }),
    /separation of duties/,
  );
  const active = service.approve(definition.id, {
    approvedBy: 'user-approver',
    approverRole: 'quality_risk',
  });
  assert.equal(active.status, 'active');
  assert.equal(active.approval?.approverRole, 'quality_risk');
  assert.equal(audit.query({ action: 'metric.approved' }).length, 1);
});

test('observations require active metric, allowed segmentation, and provenance', () => {
  const { service } = harness();
  const draft = service.define(baseDefinition());
  service.registerCalculator(draft.id, () => ({
    value: 95,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 'synthetic-fixture', detail: 'test', asOf: NOW().toISOString() }],
  }));
  assert.throws(() => service.compute(draft.id, { organizationId: ORG }), /not active/);

  const orgOnly = activeMetric(service, { id: 'test.org_only', segmentation: ['organization'] });
  service.registerCalculator(orgOnly.id, () => ({
    value: 1,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 's', detail: 'd', asOf: NOW().toISOString() }],
  }));
  assert.throws(
    () => service.compute(orgOnly.id, { organizationId: ORG, facilityId: 'fac-akron' }),
    /does not support facility/,
  );

  const noProv = activeMetric(service, { id: 'test.no_provenance' });
  service.registerCalculator(noProv.id, () => ({
    value: 1,
    asOf: NOW().toISOString(),
    provenance: [],
  }));
  assert.throws(() => service.compute(noProv.id, { organizationId: ORG }), /requires provenance/);
});

test('compute records history; latest and previous power trends', () => {
  const { service } = harness();
  const metric = activeMetric(service);
  let value = 70;
  service.registerCalculator(metric.id, () => ({
    value,
    numerator: value,
    denominator: 100,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 'synthetic-fixture', detail: 'run', asOf: NOW().toISOString() }],
  }));
  const scope = { organizationId: ORG };
  service.compute(metric.id, scope);
  value = 82;
  const second = service.compute(metric.id, scope);
  assert.equal(second?.value, 82);
  assert.equal(service.latest(metric.id, scope)?.value, 82);
  assert.equal(service.previous(metric.id, scope)?.value, 70);
});

test('a failing or absent source yields null observation, never a guess', () => {
  const { service } = harness();
  const metric = activeMetric(service);
  service.registerCalculator(metric.id, () => {
    throw new Error('source down');
  });
  assert.equal(service.compute(metric.id, { organizationId: ORG }), null);
});

test('entryStatus handles both directionalities, bands, and no data', () => {
  const higher = { directionality: 'higher_is_better', target: 85, warningThreshold: 75 } as MetricDefinition;
  assert.equal(entryStatus(higher, 90), 'on_target');
  assert.equal(entryStatus(higher, 80), 'warning');
  assert.equal(entryStatus(higher, 60), 'off_target');
  assert.equal(entryStatus(higher, undefined), 'no_data');
  const lower = { directionality: 'lower_is_better', target: 5, warningThreshold: 8 } as MetricDefinition;
  assert.equal(entryStatus(lower, 4), 'on_target');
  assert.equal(entryStatus(lower, 7), 'warning');
  assert.equal(entryStatus(lower, 12), 'off_target');
  const informational = { directionality: 'higher_is_better' } as MetricDefinition;
  assert.equal(entryStatus(informational, 42), 'informational');
});

test('scorecard view carries definition tooltip and provenance per entry', () => {
  const { service } = harness();
  seedMetricDefinitions(service, { definedBy: 'seed-quality', approvedBy: 'seed-exec' });
  service.registerCalculator('census.occupancy_rate', (scope) => ({
    value: 86,
    numerator: 43,
    denominator: 50,
    asOf: NOW().toISOString(),
    provenance: [
      {
        sourceSystem: 'mock-kipu',
        detail: `census for ${scope.facilityId ?? 'org'}`,
        asOf: NOW().toISOString(),
        recordCount: 2,
      },
    ],
  }));
  service.registerCalculator('work.overdue_items', () => ({
    value: 1,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 'aip-work-service', detail: 'queue scan', asOf: NOW().toISOString() }],
  }));
  service.registerCalculator('admissions.conversion_rate', () => undefined);
  service.registerCalculator('revenue.denial_rate', () => ({
    value: 15,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 'mock-collaboratemd', detail: 'claims scan', asOf: NOW().toISOString() }],
  }));

  const view = service.scorecardView(EXECUTIVE_SCORECARD_ID, { organizationId: ORG });
  const flat = view.sections.flatMap((s) => s.entries);
  const occupancy = flat.find((e) => e.metricId === 'census.occupancy_rate');
  assert.equal(occupancy?.status, 'on_target');
  assert.equal(occupancy?.definition.businessQuestion, 'Are we filling the beds we operate?');
  assert.equal(occupancy?.observation?.provenance[0]?.sourceSystem, 'mock-kipu');
  const overdue = flat.find((e) => e.metricId === 'work.overdue_items');
  assert.equal(overdue?.status, 'warning');
  const conversion = flat.find((e) => e.metricId === 'admissions.conversion_rate');
  assert.equal(conversion?.status, 'no_data');
  const denial = flat.find((e) => e.metricId === 'revenue.denial_rate');
  assert.equal(denial?.status, 'off_target');
  const ama = flat.find((e) => e.metricId === 'ama.weekend_rate');
  assert.equal(ama?.status, 'no_data', 'no calculator until vendor discovery');
});

test('facility-scoped scorecard falls back to org scope for org-only metrics', () => {
  const { service } = harness();
  seedMetricDefinitions(service, { definedBy: 'a', approvedBy: 'b' });
  service.registerCalculator('admissions.conversion_rate', (scope) => ({
    value: 66,
    asOf: NOW().toISOString(),
    provenance: [
      { sourceSystem: 'mock-salesforce', detail: `scope=${scope.facilityId ?? 'org'}`, asOf: NOW().toISOString() },
    ],
  }));
  const view = service.scorecardView(EXECUTIVE_SCORECARD_ID, {
    organizationId: ORG,
    facilityId: 'fac-akron',
  });
  const conversion = view.sections.flatMap((s) => s.entries).find((e) => e.metricId === 'admissions.conversion_rate');
  assert.equal(conversion?.observation?.scope.facilityId, undefined, 'computed at org scope');
});

test('CSV export includes definition and provenance columns, escapes safely', () => {
  const { service } = harness();
  const metric = activeMetric(service, {
    id: 'test.csv_metric',
    name: 'Tricky, "name"',
  });
  service.registerCalculator(metric.id, () => ({
    value: 91,
    asOf: NOW().toISOString(),
    provenance: [{ sourceSystem: 'synthetic-fixture', detail: 'x', asOf: NOW().toISOString() }],
  }));
  service.defineScorecard({
    id: 'csv-card',
    name: 'CSV card',
    description: 'test',
    sections: [{ title: 'Main', metricIds: [metric.id] }],
  });
  const csv = renderScorecardCsv(service.scorecardView('csv-card', { organizationId: ORG }));
  const lines = csv.trim().split('\n');
  assert.match(lines[0] ?? '', /metric_id,metric_name,value/);
  assert.match(lines[1] ?? '', /"Tricky, ""name"""/);
  assert.match(lines[1] ?? '', /synthetic-fixture/);
  assert.match(lines[1] ?? '', /on_target/);
});

test('scorecards reject unknown metrics; unknown scorecard throws', () => {
  const { service } = harness();
  assert.throws(
    () =>
      service.defineScorecard({
        id: 'bad',
        name: 'Bad',
        description: 'x',
        sections: [{ title: 'S', metricIds: ['nope.metric'] }],
      }),
    /Unknown metric/,
  );
  assert.throws(() => service.scorecardView('nope', { organizationId: ORG }), /Unknown scorecard/);
});

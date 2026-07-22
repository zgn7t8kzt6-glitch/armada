import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { LineupService, renderLineupHtml, type LineupFactsProvider } from './index.js';

const NOW = () => new Date('2026-07-21T06:00:00.000Z');
const ORG = 'org-armada';
const AKRON = 'fac-akron';
const DATE = '2026-07-21';

function fullFacts(): LineupFactsProvider {
  return {
    goldStandard: () => ({
      title: 'Warm Welcome',
      statement: 'Every patient and guest is greeted warmly by name where known.',
      huddlePrompt: 'Tell about a first impression that changed engagement.',
    }),
    census: () => ({ body: 'Census 24 of 28 operated beds.', sourceSystem: 'mock-kipu', asOf: NOW().toISOString() }),
    arrivalsDischarges: () => ({ body: '2 arrivals scheduled, 1 discharge.', sourceSystem: 'mock-kipu', asOf: NOW().toISOString() }),
    authorizationRisks: () => ({ body: '1 authorization expires within 48h (ep-akron-1042).', sourceSystem: 'aip-work-service', asOf: NOW().toISOString() }),
    operationalBarriers: () => ({ body: 'Room rm-akron-12 turnover due before 15:00.', sourceSystem: 'aip-work-service', asOf: NOW().toISOString() }),
  };
}

function harness(facts: LineupFactsProvider = fullFacts()) {
  let id = 0;
  const audit = new InMemoryAuditLog({ now: NOW });
  const service = new LineupService({ audit, facts, now: NOW, newId: () => `lu-${++id}` });
  return { audit, service };
}

test('generates a draft with generated facts, sources, and human prompts', () => {
  const { service, audit } = harness();
  const lineup = service.getOrGenerate(ORG, AKRON, DATE);
  assert.equal(lineup.status, 'draft');
  assert.equal(lineup.items.length, 8);
  const census = lineup.items.find((i) => i.section === 'census');
  assert.equal(census?.source?.sourceSystem, 'mock-kipu');
  const standard = lineup.items.find((i) => i.section === 'gold_standard');
  assert.match(standard?.body ?? '', /Huddle prompt/);
  const recognition = lineup.items.find((i) => i.section === 'recognition');
  assert.equal(recognition?.generated, false);
  // Idempotent per facility+date.
  assert.equal(service.getOrGenerate(ORG, AKRON, DATE).id, lineup.id);
  assert.equal(audit.query({ action: 'lineup.generated' }).length, 1);
  assert.throws(() => service.getOrGenerate(ORG, AKRON, 'July 21'), /YYYY-MM-DD/);
});

test('lineup survives failing sources: sections degrade, lineup generates (§24)', () => {
  const facts = fullFacts();
  facts.census = () => {
    throw new Error('kipu down');
  };
  facts.goldStandard = () => undefined;
  const { service } = harness(facts);
  const lineup = service.getOrGenerate(ORG, AKRON, DATE);
  const census = lineup.items.find((i) => i.section === 'census');
  assert.equal(census?.unavailable, true);
  assert.match(census?.body ?? '', /manual downtime process/);
  const standard = lineup.items.find((i) => i.section === 'gold_standard');
  assert.match(standard?.body ?? '', /printed Gold Standards binder/);
  // Other sections still populated.
  assert.equal(lineup.items.find((i) => i.section === 'authorization_risks')?.unavailable, undefined);
});

test('edit → approve → publish workflow with role checks and immutability', () => {
  const { service, audit } = harness();
  const lineup = service.getOrGenerate(ORG, AKRON, DATE);
  const edited = service.editItem(lineup.id, {
    section: 'recognition',
    title: 'Recognition',
    body: 'Shout-out to the night BHT team for a calm, safe weekend.',
    editorId: 'user-fa',
  });
  assert.equal(edited.items.find((i) => i.section === 'recognition')?.generated, false);
  assert.equal(edited.version, 2);

  assert.throws(
    () => service.approve(lineup.id, { approvedBy: 'u', approverRole: 'nurse' }),
    /cannot approve/,
  );
  assert.throws(() => service.publish(lineup.id, 'u'), /Only approved/);

  const approved = service.approve(lineup.id, {
    approvedBy: 'user-fa',
    approverRole: 'facility_administrator',
  });
  assert.equal(approved.status, 'approved');
  assert.throws(
    () => service.editItem(lineup.id, { section: 'safety_focus', title: 'x', body: 'y', editorId: 'u' }),
    /Only draft/,
  );

  const published = service.publish(lineup.id, 'user-fa');
  assert.equal(published.status, 'published');
  assert.ok(published.publishedAt);
  assert.throws(() => service.publish(lineup.id, 'u'), /Only approved/);
  for (const action of ['lineup.edited', 'lineup.approved', 'lineup.published']) {
    assert.equal(audit.query({ action }).length, 1, action);
  }
});

test('printable view is self-contained, escaped, and flags unavailable sources', () => {
  const facts = fullFacts();
  facts.operationalBarriers = () => undefined;
  const { service } = harness(facts);
  const lineup = service.getOrGenerate(ORG, AKRON, DATE);
  service.editItem(lineup.id, {
    section: 'safety_focus',
    title: 'Safety <script>alert(1)</script>',
    body: 'Wet floors near intake & east wing.',
    editorId: 'u',
  });
  const html = renderLineupHtml(service.getById(lineup.id)!, 'Akron Residential (synthetic)');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /Source: mock-kipu/);
  assert.match(html, /Source unavailable — manual process applies/);
  assert.match(html, /never be the only copy/);
  assert.ok(!/src=|href=/.test(html), 'no external references');
});

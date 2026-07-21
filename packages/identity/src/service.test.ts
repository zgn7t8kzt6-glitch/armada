import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditLog } from '@armada/audit';
import { IdentityService } from './service.js';
import { seedIdentityScenarios } from './seed.js';
import { normalizeSignals } from './matching.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');
const AKRON = 'fac-akron';
const COLUMBUS = 'fac-columbus';

function harness() {
  let id = 0;
  const audit = new InMemoryAuditLog({ now: NOW });
  const service = new IdentityService({ audit, now: NOW, newId: () => `id-${++id}` });
  return { audit, service };
}

function basePerson(service: IdentityService) {
  return service.registerPerson(
    {
      mrn: 'M-100',
      mrnFacilityId: AKRON,
      legalName: 'Alex Doe (synthetic)',
      dateOfBirth: '1992-01-15',
      phone: '330-555-0100',
      email: 'alex.doe@synthetic.example',
    },
    'seed',
  );
}

test('normalization: case, spacing, phone punctuation', () => {
  const n = normalizeSignals({
    legalName: '  Alex   DOE (Synthetic) ',
    phone: '(330) 555-0100',
    email: 'Alex.Doe@Synthetic.Example',
    mrn: ' m-100 ',
  });
  assert.equal(n.legalName, 'alex doe (synthetic)');
  assert.equal(n.phone, '3305550100');
  assert.equal(n.email, 'alex.doe@synthetic.example');
  assert.equal(n.mrn, 'M-100');
});

test('R0: an existing crosswalk always wins', () => {
  const { service } = harness();
  const person = basePerson(service);
  const first = service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'p-1',
    signals: { mrn: 'M-100', mrnFacilityId: AKRON, dateOfBirth: '1992-01-15' },
  });
  assert.equal(first.outcome, 'auto_linked_deterministic');
  const again = service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'p-1',
    signals: {},
  });
  assert.equal(again.outcome, 'auto_linked_existing_crosswalk');
  assert.equal(again.personId, person.id);
});

test('R1: unique MRN+DOB auto-links with explanation', () => {
  const { service, audit } = harness();
  const person = basePerson(service);
  const result = service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'p-2',
    signals: { mrn: 'm-100', mrnFacilityId: AKRON, dateOfBirth: '1992-01-15' },
  });
  assert.equal(result.outcome, 'auto_linked_deterministic');
  assert.equal(result.personId, person.id);
  assert.equal(result.explanation.ruleId, 'R1_MRN_DOB');
  assert.equal(service.crosswalksFor(person.id).length, 1);
  const linked = audit.query({ action: 'identity.linked' });
  assert.equal(linked[0]?.summary, 'source=KIPU method=deterministic');
});

test('MRN match with conflicting DOB never auto-links (§24 negative)', () => {
  const { service } = harness();
  basePerson(service);
  const result = service.resolve({
    sourceSystem: 'COLLABORATEMD',
    sourceRecordId: 'acct-1',
    signals: { mrn: 'M-100', mrnFacilityId: AKRON, dateOfBirth: '1992-01-16' },
  });
  assert.equal(result.outcome, 'queued_for_review');
  assert.equal(result.explanation.reviewReason, 'conflicting_identifiers');
  const candidate = result.explanation.candidates[0];
  assert.ok(candidate?.conflictingFields.includes('dateOfBirth'));
});

test('MRN equality only counts within the issuing facility', () => {
  const { service } = harness();
  basePerson(service);
  // Same MRN string at a DIFFERENT facility + no other overlap → new person.
  const result = service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'p-3',
    signals: { mrn: 'M-100', mrnFacilityId: COLUMBUS, dateOfBirth: '1970-01-01' },
  });
  assert.equal(result.outcome, 'created_new_person');
});

test('R2: name+DOB+corroborating attribute auto-links; name+DOB alone does not', () => {
  const { service } = harness();
  const person = basePerson(service);
  const corroborated = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-1',
    signals: {
      legalName: 'ALEX DOE (synthetic)',
      dateOfBirth: '1992-01-15',
      phone: '3305550100',
    },
  });
  assert.equal(corroborated.outcome, 'auto_linked_deterministic');
  assert.equal(corroborated.explanation.ruleId, 'R2_NAME_DOB_CORROBORATED');
  assert.equal(corroborated.personId, person.id);

  const uncorroborated = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-2',
    signals: { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15' },
  });
  assert.equal(uncorroborated.outcome, 'queued_for_review');
  assert.equal(uncorroborated.explanation.reviewReason, 'low_confidence');
});

test('multiple qualifying candidates always go to review', () => {
  const { service } = harness();
  basePerson(service);
  service.registerPerson(
    { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15', phone: '330-555-0222' },
    'seed',
  );
  const result = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-9',
    signals: { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15' },
  });
  assert.equal(result.outcome, 'queued_for_review');
  assert.equal(result.explanation.reviewReason, 'multiple_candidates');
  assert.equal(result.explanation.candidates.length, 2);
});

test('review resolution: link to a candidate, then the crosswalk is durable', () => {
  const { service, audit } = harness();
  const person = basePerson(service);
  service.registerPerson(
    { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15', phone: '330-555-0222' },
    'seed',
  );
  const queued = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-10',
    signals: { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15' },
  });
  assert.ok(queued.issueId);
  const resolved = service.resolveIssue(queued.issueId, {
    action: 'link',
    userId: 'user-reviewer',
    personId: person.id,
    note: 'Phone on file matches the payer portal record.',
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolution?.personId, person.id);
  // The source ref now resolves via R0.
  const again = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-10',
    signals: {},
  });
  assert.equal(again.outcome, 'auto_linked_existing_crosswalk');
  assert.equal(again.personId, person.id);
  assert.ok(audit.query({ action: 'identity.review_resolved' }).length === 1);
  // Cannot re-resolve.
  assert.throws(
    () => service.resolveIssue(queued.issueId!, { action: 'defer', userId: 'x' }),
    /already resolved/,
  );
});

test('review guards: link target must be an active candidate; defer stays workable', () => {
  const { service } = harness();
  basePerson(service);
  service.registerPerson(
    { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15', phone: '330-555-0222' },
    'seed',
  );
  const stranger = service.registerPerson(
    { legalName: 'Sam Other (synthetic)', dateOfBirth: '1970-05-05' },
    'seed',
  );
  const queued = service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-11',
    signals: { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15' },
  });
  assert.ok(queued.issueId);
  assert.throws(
    () =>
      service.resolveIssue(queued.issueId!, {
        action: 'link',
        userId: 'u',
        personId: stranger.id,
      }),
    /must be one of the issue candidates/,
  );
  const deferred = service.resolveIssue(queued.issueId!, { action: 'defer', userId: 'u' });
  assert.equal(deferred.status, 'deferred');
  const created = service.resolveIssue(queued.issueId!, { action: 'create_new', userId: 'u' });
  assert.equal(created.status, 'resolved');
  assert.equal(created.history.length, 2);
});

test('merge requires dual confirmation and moves crosswalks; unmerge restores', () => {
  const { service, audit } = harness();
  const primary = basePerson(service);
  const duplicate = service.registerPerson(
    { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15', phone: '330-555-0222' },
    'seed',
  );
  // Give the primary its own crosswalk via R1.
  service.resolve({
    sourceSystem: 'KIPU',
    sourceRecordId: 'p-primary',
    signals: { mrn: 'M-100', mrnFacilityId: AKRON, dateOfBirth: '1992-01-15' },
  });
  service.resolve({
    sourceSystem: 'SALESFORCE',
    sourceRecordId: 'lead-dup',
    signals: { legalName: 'Alex Doe (synthetic)', dateOfBirth: '1992-01-15', phone: '330-555-0222' },
  });
  assert.equal(service.crosswalksFor(duplicate.id).length, 1);

  const merge = service.requestMerge({
    primaryPersonId: primary.id,
    duplicatePersonId: duplicate.id,
    reason: 'Same person confirmed by payer member ID review',
    requestedBy: 'user-a',
  });
  // Same-user confirmation rejected (dual confirmation).
  assert.throws(() => service.confirmMerge(merge.id, 'user-a'), /second reviewer/);
  const executed = service.confirmMerge(merge.id, 'user-b');
  assert.equal(executed.status, 'executed');
  assert.equal(service.crosswalksFor(primary.id).length, 2);
  assert.equal(service.crosswalksFor(duplicate.id).length, 0);
  assert.equal(service.personById(duplicate.id)?.mergedInto, primary.id);
  // Resolving the duplicate's source ref lands on the primary.
  const followed = service.resolve({ sourceSystem: 'SALESFORCE', sourceRecordId: 'lead-dup', signals: {} });
  assert.equal(followed.personId, primary.id);

  const unmerged = service.unmerge(merge.id, {
    userId: 'user-c',
    reason: 'Merge was wrong: different payer records',
  });
  assert.equal(unmerged.status, 'unmerged');
  assert.equal(service.personById(duplicate.id)?.mergedInto, undefined);
  assert.equal(service.crosswalksFor(duplicate.id).length, 1);
  for (const action of ['identity.merge_requested', 'identity.merge_confirmed', 'identity.unmerged']) {
    assert.equal(audit.query({ action }).length, 1, action);
  }
});

test('merge validation: self-merge, short reasons, inactive participants', () => {
  const { service } = harness();
  const person = basePerson(service);
  assert.throws(
    () =>
      service.requestMerge({
        primaryPersonId: person.id,
        duplicatePersonId: person.id,
        reason: 'valid enough reason',
        requestedBy: 'u',
      }),
    /themselves/,
  );
  assert.throws(
    () =>
      service.requestMerge({
        primaryPersonId: person.id,
        duplicatePersonId: 'id-nope',
        reason: 'valid enough reason',
        requestedBy: 'u',
      }),
    /not active/,
  );
});

test('audit events never contain signal values (PHI safety)', () => {
  const { service, audit } = harness();
  seedIdentityScenarios(service, { akron: AKRON, columbus: COLUMBUS });
  const serialized = JSON.stringify(audit.query());
  assert.ok(!serialized.includes('Jordan Rivers'), 'no names');
  assert.ok(!serialized.toLowerCase().includes('jordan'), 'no normalized names');
  assert.ok(!serialized.includes('1990-04-12'), 'no DOBs');
  assert.ok(!serialized.includes('synthetic.example'), 'no emails');
});

test('seed scenarios cover auto-link, multi-candidate, and conflict paths', () => {
  const { service } = harness();
  const summary = seedIdentityScenarios(service, { akron: AKRON, columbus: COLUMBUS });
  assert.equal(summary.autoLinked.outcome, 'auto_linked_deterministic');
  assert.equal(summary.multiCandidateIssue.outcome, 'queued_for_review');
  assert.equal(summary.multiCandidateIssue.explanation.reviewReason, 'multiple_candidates');
  assert.equal(summary.conflictIssue.outcome, 'queued_for_review');
  assert.equal(summary.conflictIssue.explanation.reviewReason, 'conflicting_identifiers');
  assert.equal(service.issues({ status: 'open' }).length, 2);
});

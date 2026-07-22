import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExcellenceContentService } from './service.js';
import { seedExcellenceContent } from './seed.js';
import type { ConstitutionBody } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');

function svc(): ExcellenceContentService {
  let id = 0;
  return new ExcellenceContentService({ now: NOW, newId: () => `content-${++id}` });
}

const CREDO: ConstitutionBody = {
  kind: 'constitution_document',
  docType: 'credo',
  text: 'We meet people with excellence.',
};

test('full workflow: draft → edit → submit → approve → publish', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.version, 1);

  const edited = service.editDraft(draft.contentId, {
    editorId: 'author-1',
    body: { ...CREDO, text: 'We meet people with excellence, every time.' },
  });
  assert.equal(edited.status, 'draft');

  const submitted = service.submitForReview(draft.contentId, 'author-1');
  assert.equal(submitted.status, 'in_review');
  assert.equal(submitted.submittedAt, NOW().toISOString());

  const approved = service.approve(draft.contentId, {
    approverId: 'approver-1',
    approverRole: 'executive',
    note: 'Looks right',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approval?.approverRole, 'executive');

  const published = service.publish(draft.contentId);
  assert.equal(published.status, 'published');
  assert.equal(service.getPublished(draft.contentId)?.version, 1);
  assert.equal(service.listPublished('constitution_document').length, 1);
});

test('separation of duties: author cannot approve their own content', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  service.submitForReview(draft.contentId, 'author-1');
  assert.throws(
    () => service.approve(draft.contentId, { approverId: 'author-1', approverRole: 'executive' }),
    /separation of duties/,
  );
});

test('only approver roles may approve; only authors may submit', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  assert.throws(() => service.submitForReview(draft.contentId, 'someone-else'), /Only the author/);
  service.submitForReview(draft.contentId, 'author-1');
  assert.throws(
    () => service.approve(draft.contentId, { approverId: 'x', approverRole: 'nurse' }),
    /not an approver role/,
  );
});

test('content is immutable after submission; transitions are enforced', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  service.submitForReview(draft.contentId, 'author-1');
  assert.throws(() => service.editDraft(draft.contentId, { editorId: 'author-1', title: 'X' }));
  assert.throws(() => service.publish(draft.contentId), /Only approved/);
  assert.throws(() => service.submitForReview(draft.contentId, 'author-1'));
  const version = service.getLatest(draft.contentId);
  assert.ok(version !== undefined && Object.isFrozen(version));
});

test('publishing a revision supersedes the previous version, history preserved', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  service.submitForReview(draft.contentId, 'author-1');
  service.approve(draft.contentId, { approverId: 'a2', approverRole: 'quality_risk' });
  service.publish(draft.contentId);

  const v2 = service.reviseDraft(draft.contentId, {
    title: 'Credo (revised)',
    body: { ...CREDO, text: 'Updated text.' },
    authorId: 'author-2',
  });
  assert.equal(v2.version, 2);
  // Old version still the published one until v2 completes the workflow.
  assert.equal(service.getPublished(draft.contentId)?.version, 1);

  service.submitForReview(draft.contentId, 'author-2');
  service.approve(draft.contentId, { approverId: 'a3', approverRole: 'executive' });
  service.publish(draft.contentId);

  const history = service.history(draft.contentId);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.status, 'superseded');
  assert.equal(history[1]?.status, 'published');
  assert.equal(service.getPublished(draft.contentId)?.title, 'Credo (revised)');
  // Approval history of the superseded version is intact.
  assert.equal(history[0]?.approval?.approverRole, 'quality_risk');
});

test('revision rules: only from published; kind cannot change', () => {
  const service = svc();
  const draft = service.createDraft({ title: 'Credo', body: CREDO, authorId: 'author-1' });
  assert.throws(() =>
    service.reviseDraft(draft.contentId, { title: 'X', body: CREDO, authorId: 'a' }),
  );
  service.submitForReview(draft.contentId, 'author-1');
  service.approve(draft.contentId, { approverId: 'a2', approverRole: 'executive' });
  service.publish(draft.contentId);
  assert.throws(
    () =>
      service.reviseDraft(draft.contentId, {
        title: 'X',
        body: { kind: 'policy' } as never,
        authorId: 'a',
      }),
    /kind cannot change|must not be empty/,
  );
});

test('body validation rejects incomplete gold standards and bad roles', () => {
  const service = svc();
  assert.throws(() =>
    service.createDraft({
      title: 'Bad standard',
      authorId: 'a',
      body: {
        kind: 'gold_standard',
        statement: '',
        whyItMatters: 'x',
        observableBehaviors: [],
        unacceptableBehaviors: [],
        roleExamples: [],
        patientExperienceConnection: 'x',
        complianceConnection: 'x',
        huddlePrompt: 'x',
        recognitionExamples: [],
      },
    }),
  );
  assert.throws(() =>
    service.createDraft({
      title: 'Bad card',
      authorId: 'a',
      body: {
        kind: 'role_card',
        role: 'wizard' as never,
        rolePurpose: 'x',
        patientPromise: 'x',
        topResponsibilities: ['x'],
        shiftStart: ['x'],
        duringShift: ['x'],
        shiftEnd: ['x'],
        momentsOfTruth: [],
        escalationTriggers: ['x'],
        documentationResponsibilities: [],
        kpis: [],
        competencies: [],
        requiredPolicies: [],
        goldStandardExamples: [],
        careerPath: [],
      },
    }),
  );
});

test('seed publishes starter content with approval history and role-card lookup', () => {
  const service = svc();
  const published = seedExcellenceContent(service, {
    authorId: 'author-1',
    approverId: 'approver-1',
    approverRole: 'executive',
  });
  assert.equal(published.length, 8);
  assert.equal(service.listPublished('gold_standard').length, 3);
  assert.equal(service.listPublished('role_card').length, 2);
  assert.equal(service.listPublished('policy').length, 1);
  assert.equal(service.listPublished('constitution_document').length, 2);
  const nurseCard = service.findPublishedRoleCard('nurse');
  assert.ok(nurseCard !== undefined);
  assert.equal(nurseCard.approval?.approverRole, 'executive');
  assert.equal(service.findPublishedRoleCard('provider'), undefined);
});

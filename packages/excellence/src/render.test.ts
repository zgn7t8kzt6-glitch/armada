import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlainText, renderPrintableHtml } from './render.js';
import { searchPublished } from './search.js';
import { ExcellenceContentService } from './service.js';
import { seedExcellenceContent } from './seed.js';
import type { ContentVersion } from './types.js';

const NOW = () => new Date('2026-07-21T12:00:00.000Z');

function publishedSeed(): readonly ContentVersion[] {
  const service = new ExcellenceContentService({ now: NOW });
  return seedExcellenceContent(service, {
    authorId: 'author-1',
    approverId: 'approver-1',
    approverRole: 'executive',
  });
}

test('printable HTML is self-contained, versioned, and marked uncontrolled', () => {
  const version = publishedSeed().find((v) => v.title === 'Warm Welcome');
  assert.ok(version);
  const html = renderPrintableHtml(version);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /Warm Welcome/);
  assert.match(html, /Version 1 — status: published/);
  assert.match(html, /Approved by role executive/);
  assert.match(html, /Printed copies are uncontrolled/);
  assert.ok(!html.includes('<script'), 'no scripts');
  assert.ok(!/src=|href=/.test(html), 'no external references');
});

test('user-authored content is HTML-escaped in printable output', () => {
  const service = new ExcellenceContentService({ now: NOW });
  const draft = service.createDraft({
    title: 'Evil <script>alert("x")</script> title',
    authorId: 'a',
    body: {
      kind: 'constitution_document',
      docType: 'credo',
      text: 'Body with <img src=x onerror=alert(1)> injection & "quotes".',
    },
  });
  const html = renderPrintableHtml(draft);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp; &quot;quotes&quot;'));
});

test('plain-text export carries all sections for offline binders', () => {
  const version = publishedSeed().find((v) => v.title === 'Role Card — Nurse');
  assert.ok(version);
  const text = renderPlainText(version);
  assert.match(text, /ROLE CARD — NURSE/);
  assert.match(text, /## Shift start — standard work/);
  assert.match(text, /- Receive handoff using the standard format/);
  assert.match(text, /Printed copies are uncontrolled/);
});

test('search finds content by topic with title boost and snippets', () => {
  const published = publishedSeed();
  const weekend = searchPublished(published, 'weekend AMA');
  assert.ok(weekend.length >= 1);
  assert.equal(weekend[0]?.title, 'Safe and Ready Weekend');
  assert.ok(weekend[0]!.snippet.length > 0);

  const recovery = searchPublished(published, 'service recovery');
  assert.equal(recovery[0]?.title, 'Service Recovery');

  assert.deepEqual(searchPublished(published, ''), []);
  assert.deepEqual(searchPublished(published, 'zebra unicorn'), []);
});

test('search title boost outranks body-only matches', () => {
  const published = publishedSeed();
  const hits = searchPublished(published, 'welcome');
  assert.ok(hits.length >= 2, 'Warm Welcome title + role-card references');
  assert.equal(hits[0]?.title, 'Warm Welcome');
});

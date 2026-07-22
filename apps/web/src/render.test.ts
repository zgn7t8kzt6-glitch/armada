import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  layout,
  navFor,
  renderHome,
  renderLogin,
  renderWorkTable,
  statusBadge,
  type MeView,
  type WorkItemView,
} from './render.js';

function me(roles: string[]): MeView {
  return {
    displayName: 'Test User',
    email: 'test@dev.armada.example',
    assignments: roles.map((role) => ({ role, facilityScope: 'all' as const })),
  };
}

test('navigation is role-relevant (§2.2)', () => {
  const bht = navFor(me(['bht_recovery_support'])).map((l) => l.label);
  assert.ok(bht.includes('Daily Lineup'));
  assert.ok(bht.includes('Scorecard'));
  assert.ok(!bht.includes('Identity Review'));
  assert.ok(!bht.includes('Integrations'));

  const privacy = navFor(me(['privacy_administrator'])).map((l) => l.label);
  assert.ok(privacy.includes('Identity Review'));
  assert.ok(!privacy.includes('Scorecard'));

  const sysadmin = navFor(me(['system_administrator'])).map((l) => l.label);
  assert.ok(sysadmin.includes('Integrations'));

  const quality = navFor(me(['quality_risk'])).map((l) => l.label);
  assert.ok(quality.includes('Compliance'));
});

test('status badges carry text and symbol, never color alone (§20)', () => {
  assert.match(statusBadge('on_target'), /✓ on target/);
  assert.match(statusBadge('warning'), /△ warning/);
  assert.match(statusBadge('off_target'), /✗ off target/);
  assert.match(statusBadge('no_data'), /– no data/);
});

test('all user content is escaped in layout and tables', () => {
  const item: WorkItemView = {
    id: 'wi-1',
    title: 'Evil <script>alert(1)</script> title',
    explanation: 'Injection & "quotes"',
    priority: 'high',
    status: 'open',
    dueAt: '2026-07-21T12:00:00.000Z',
    ownerRole: 'nurse',
    facilityId: 'fac-akron',
    requiredAction: 'Do <b>the</b> thing',
  };
  const html = renderHome({
    me: { ...me(['nurse']), displayName: '<img src=x onerror=alert(1)>' },
    myWork: [item],
    notificationCount: 2,
    panels: [],
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Injection &amp; &quot;quotes&quot;'));
  assert.ok(html.includes('&lt;b&gt;the&lt;/b&gt;'));
});

test('pages are accessible scaffolding: lang, skip link, labeled nav, captions', () => {
  const html = layout({ title: 'Test', me: me(['nurse']), content: '<p>x</p>' });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /class="skip" href="#main"/);
  assert.match(html, /aria-label="Main"/);
  const table = renderWorkTable(
    [
      {
        id: 'wi-1',
        title: 'T',
        explanation: 'E',
        priority: 'low',
        status: 'open',
        dueAt: '2026-07-21T12:00:00.000Z',
        ownerRole: 'nurse',
        facilityId: 'f',
        requiredAction: 'A',
      },
    ],
    'caption text',
  );
  assert.match(table, /<caption/);
  assert.match(table, /scope="col"/);
});

test('login page renders the dev-idp notice and empty queue is honest', () => {
  const login = renderLogin();
  assert.match(login, /Development identity provider/);
  assert.match(login, /autocomplete="username"/);
  assert.match(renderWorkTable([], 'nothing here'), /No work items/);
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

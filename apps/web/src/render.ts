/**
 * Server-side page rendering for the role-based workspaces (Epic 10,
 * ADR-0016). Design goals per blueprint §20: calm, plain-language,
 * keyboard-navigable, high-contrast, status never conveyed by color alone.
 * Everything is escaped — all content is data.
 */

export interface MeView {
  readonly displayName: string;
  readonly email: string;
  readonly assignments: readonly { role: string; facilityScope: 'all' | readonly string[] }[];
}

export interface WorkItemView {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly priority: string;
  readonly status: string;
  readonly dueAt: string;
  readonly ownerRole: string;
  readonly facilityId: string;
  readonly requiredAction: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STATUS_MARKS: Record<string, string> = {
  on_target: '✓ on target',
  warning: '△ warning',
  off_target: '✗ off target',
  informational: 'ℹ info',
  no_data: '– no data',
};

/** Text + symbol, never color alone (§20). */
export function statusBadge(status: string): string {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(
    STATUS_MARKS[status] ?? status,
  )}</span>`;
}

const PRIORITY_MARKS: Record<string, string> = {
  critical: '‼ critical',
  high: '! high',
  medium: '· medium',
  low: '· low',
};

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

/** Role relevance (§2.2): navigation is built from what the user may do. */
export function navFor(me: MeView): readonly NavLink[] {
  const roles = new Set(me.assignments.map((a) => a.role));
  const links: NavLink[] = [
    { href: '/', label: 'Home' },
    { href: '/work', label: 'My Work' },
    { href: '/lineup', label: 'Daily Lineup' },
    { href: '/library', label: 'Excellence Library' },
  ];
  const scorecardRoles = [
    'executive',
    'facility_administrator',
    'medical_director',
    'provider',
    'nursing_director',
    'nurse',
    'clinical_director',
    'therapist_counselor',
    'case_manager',
    'admissions',
    'utilization_review',
    'bht_recovery_support',
    'read_only_auditor',
  ];
  if (scorecardRoles.some((r) => roles.has(r))) {
    links.push({ href: '/scorecard', label: 'Scorecard' });
  }
  if (['privacy_administrator', 'compliance_administrator', 'quality_risk'].some((r) => roles.has(r))) {
    links.push({ href: '/reconciliation', label: 'Identity Review' });
  }
  if (['compliance_administrator', 'quality_risk', 'executive', 'read_only_auditor'].some((r) => roles.has(r))) {
    links.push({ href: '/compliance', label: 'Compliance' });
  }
  if (roles.has('system_administrator')) {
    links.push({ href: '/admin', label: 'Integrations' });
  }
  return links;
}

const BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f7f6f3; color: #1f2933; line-height: 1.55; }
  .skip { position: absolute; left: -999px; } .skip:focus { left: 1rem; top: 1rem; background: #fff; padding: 0.5rem; z-index: 10; }
  header.site { background: #12333f; color: #f2f0ea; padding: 0.9rem 1.25rem; display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: baseline; }
  header.site h1 { font-size: 1.05rem; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
  nav.site a { color: #cfe3e9; text-decoration: none; margin-right: 1rem; }
  nav.site a:hover, nav.site a:focus { text-decoration: underline; color: #ffffff; }
  main { max-width: 62rem; margin: 1.5rem auto 3rem; padding: 0 1.25rem; }
  h2 { font-size: 1.2rem; margin: 1.6rem 0 0.6rem; } h3 { font-size: 1rem; margin: 1rem 0 0.4rem; }
  section.panel { background: #ffffff; border: 1px solid #e1ded7; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1.1rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
  th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #eceae4; vertical-align: top; }
  th { font-weight: 600; color: #52606d; }
  .badge { font-size: 0.82rem; font-weight: 600; padding: 0.1rem 0.45rem; border-radius: 4px; border: 1px solid #cbd2d9; background: #f5f7fa; white-space: nowrap; }
  .badge-on_target { border-color: #2f855a; } .badge-warning { border-color: #b7791f; } .badge-off_target { border-color: #c53030; }
  .meta { color: #616e7c; font-size: 0.82rem; }
  .notice { background: #fffaf0; border: 1px solid #ecc94b; border-radius: 6px; padding: 0.75rem 1rem; }
  form.stack label { display: block; margin: 0.8rem 0 0.25rem; font-weight: 600; }
  input[type=email], input[type=text] { width: 100%; max-width: 24rem; padding: 0.5rem; border: 1px solid #9aa5b1; border-radius: 4px; font-size: 1rem; }
  button { background: #12333f; color: #fff; border: 0; border-radius: 4px; padding: 0.55rem 1.1rem; font-size: 0.95rem; cursor: pointer; margin-top: 0.9rem; }
  button:hover, button:focus { background: #1d4b5c; }
  a { color: #175a6e; }
  footer.site { max-width: 62rem; margin: 0 auto 2rem; padding: 0 1.25rem; color: #7b8794; font-size: 0.8rem; }
`;

export function layout(input: {
  readonly title: string;
  readonly content: string;
  readonly me?: MeView;
}): string {
  const nav =
    input.me !== undefined
      ? `<nav class="site" aria-label="Main">${navFor(input.me)
          .map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`)
          .join('')}</nav>
        <form method="post" action="/logout" style="margin-left:auto"><button type="submit">Sign out</button></form>`
      : '';
  const identity =
    input.me !== undefined
      ? `<p class="meta" style="color:#cfe3e9;margin:0">${escapeHtml(input.me.displayName)}</p>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} — Armada Excellence OS</title>
<style>${BASE_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <h1>Armada Excellence OS</h1>
  ${nav}
  ${identity}
</header>
<main id="main">
${input.content}
</main>
<footer class="site">Development environment · synthetic data only · every fact shows its source and freshness.</footer>
</body>
</html>
`;
}

export function renderLogin(error?: string): string {
  const alert =
    error !== undefined
      ? `<p class="notice" role="alert">${escapeHtml(error)}</p>`
      : '';
  return layout({
    title: 'Sign in',
    content: `
<section class="panel" style="max-width:28rem">
  <h2 style="margin-top:0">Sign in</h2>
  ${alert}
  <form class="stack" method="post" action="/login">
    <label for="email">Work email</label>
    <input id="email" name="email" type="email" required autocomplete="username">
    <button type="submit">Sign in</button>
  </form>
  <p class="meta">Development identity provider — synthetic users only. Production sign-in uses the organization's SSO with MFA.</p>
</section>`,
  });
}

export function renderWorkTable(items: readonly WorkItemView[], caption: string): string {
  if (items.length === 0) {
    return `<p>No work items. <span class="meta">(${escapeHtml(caption)})</span></p>`;
  }
  const rows = items
    .map(
      (i) => `<tr>
  <td><span class="badge">${escapeHtml(PRIORITY_MARKS[i.priority] ?? i.priority)}</span></td>
  <td><strong>${escapeHtml(i.title)}</strong><br><span class="meta">${escapeHtml(i.explanation)}</span><br><span class="meta">Next action: ${escapeHtml(i.requiredAction)}</span></td>
  <td>${escapeHtml(i.status)}</td>
  <td>${escapeHtml(i.dueAt.slice(0, 16).replace('T', ' '))}</td>
  <td>${escapeHtml(i.ownerRole)}</td>
</tr>`,
    )
    .join('\n');
  return `<table>
<caption class="meta" style="text-align:left;margin-bottom:0.4rem">${escapeHtml(caption)}</caption>
<thead><tr><th scope="col">Priority</th><th scope="col">Work item</th><th scope="col">Status</th><th scope="col">Due (UTC)</th><th scope="col">Owner role</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

export function renderHome(input: {
  readonly me: MeView;
  readonly myWork: readonly WorkItemView[];
  readonly notificationCount: number;
  readonly panels: readonly string[];
}): string {
  const roles = input.me.assignments.map((a) => a.role).join(', ');
  const content = `
<h2>Welcome, ${escapeHtml(input.me.displayName)}</h2>
<p class="meta">Roles: ${escapeHtml(roles)} · ${input.notificationCount} notification(s)</p>
<section class="panel">
  <h3 style="margin-top:0">My work — the correct next action, always visible</h3>
  ${renderWorkTable(input.myWork, 'Top items owned by you or your role')}
  <p><a href="/work">See the full queue →</a></p>
</section>
${input.panels.join('\n')}
`;
  return layout({ title: 'Home', me: input.me, content });
}

export function panel(title: string, bodyHtml: string): string {
  return `<section class="panel"><h3 style="margin-top:0">${escapeHtml(title)}</h3>${bodyHtml}</section>`;
}

export function renderError(me: MeView | undefined, title: string, message: string): string {
  return layout({
    title,
    ...(me !== undefined ? { me } : {}),
    content: `<section class="panel"><h2 style="margin-top:0">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></section>`,
  });
}

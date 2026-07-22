/**
 * Server-side rendering and the Armada Recovery design system (Epic 10,
 * ADR-0016). Brand: the pyramid-sunrise mark (recreated as inline SVG —
 * no external assets, CSP stays strict) with the deep pine wordmark;
 * palette drawn from the logo (pine green, sunrise orange, lagoon teal on
 * warm paper). Principles per blueprint §20: calm, plain language,
 * keyboard-navigable, high contrast, status never conveyed by color alone.
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

/** The Armada pyramid-sunrise mark, recreated as a lightweight inline SVG. */
export function logoSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Armada Recovery mark" fill="none">
<defs><linearGradient id="armada-g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#E9A862"/><stop offset="1" stop-color="#74C3C9"/>
</linearGradient></defs>
<g stroke="url(#armada-g)" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round">
<path d="M50 7 L13 63 L50 84 L87 63 Z"/>
<path d="M50 7 L50 84"/>
<path d="M31 63 A19 19 0 0 1 69 63"/>
</g>
</svg>`;
}

const FAVICON = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9A862"/><stop offset="1" stop-color="#74C3C9"/></linearGradient></defs><g stroke="url(#g)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><path d="M50 7 L13 63 L50 84 L87 63 Z"/><path d="M50 7 L50 84"/><path d="M31 63 A19 19 0 0 1 69 63"/></g></svg>`,
);

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

/** Friendly one-liners for the home quick-access tiles. */
const NAV_DESCRIPTIONS: Record<string, string> = {
  '/work': 'Everything you own, sorted by what is due next.',
  '/lineup': "Today's huddle: standard, census, risks, recognition.",
  '/library': 'Gold Standards, role cards, policies — always printable.',
  '/scorecard': 'The numbers that matter, with sources and definitions.',
  '/reconciliation': 'Review identity matches — nothing merges without you.',
  '/compliance': 'Survey readiness, evidence, and corrective actions.',
  '/admin': 'Connector health, ingestion runs, and data freshness.',
};

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

const TITLE_TO_PATH: Record<string, string> = {
  Home: '/',
  'My Work': '/work',
  'Daily Lineup': '/lineup',
  'Excellence Library': '/library',
  Scorecard: '/scorecard',
  'Identity review': '/reconciliation',
  'Compliance readiness': '/compliance',
  Integrations: '/admin',
};

const BASE_CSS = `
  :root {
    --pine: #2b5449; --pine-deep: #1d3c33; --pine-soft: #3c6b5d;
    --sunrise: #e9a862; --lagoon: #74c3c9; --lagoon-deep: #1f6f6b;
    --paper: #faf8f3; --card: #ffffff; --line: #e8e3d8; --line-soft: #f0ece2;
    --ink: #26352f; --muted: #64716b;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; background: var(--paper); color: var(--ink); line-height: 1.6; }
  .serif { font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif; }
  .skip { position: absolute; left: -999px; } .skip:focus { left: 1rem; top: 1rem; background: #fff; padding: 0.5rem 0.8rem; z-index: 10; border-radius: 6px; box-shadow: 0 2px 8px rgba(29,60,51,0.25); }

  header.site { background: var(--card); border-bottom: 1px solid var(--line); padding: 0.7rem 1.4rem; display: flex; flex-wrap: wrap; gap: 0.6rem 1.4rem; align-items: center; position: sticky; top: 0; z-index: 5; }
  .brand { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; }
  .brand-word { font-family: Georgia, serif; font-size: 1.35rem; color: var(--pine); font-weight: 600; letter-spacing: 0.01em; line-height: 1; }
  .brand-sub { display: block; font-size: 0.55rem; letter-spacing: 0.34em; color: var(--pine-soft); font-weight: 600; margin-top: 0.15rem; }
  nav.site { display: flex; flex-wrap: wrap; gap: 0.15rem; }
  nav.site a { color: var(--pine-soft); text-decoration: none; padding: 0.42rem 0.75rem; border-radius: 999px; font-size: 0.92rem; font-weight: 500; }
  nav.site a:hover, nav.site a:focus-visible { background: var(--line-soft); color: var(--pine-deep); }
  nav.site a[aria-current="page"] { background: var(--pine); color: #f6f3ec; }
  .header-end { margin-left: auto; display: flex; align-items: center; gap: 0.8rem; }
  .whoami { font-size: 0.85rem; color: var(--muted); text-align: right; line-height: 1.25; }
  .whoami strong { color: var(--ink); font-weight: 600; display: block; }

  main { max-width: 64rem; margin: 1.8rem auto 3rem; padding: 0 1.3rem; }
  h2 { font-family: Georgia, serif; font-size: 1.55rem; font-weight: 600; color: var(--pine-deep); margin: 1.4rem 0 0.4rem; }
  h3 { font-size: 1.02rem; margin: 1rem 0 0.4rem; color: var(--pine-deep); }
  .lede { color: var(--muted); margin: 0 0 1.2rem; }

  section.panel { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.15rem 1.35rem; margin-bottom: 1.15rem; box-shadow: 0 1px 2px rgba(29,60,51,0.05); }
  .accent-top { border-top: 3px solid transparent; border-image: linear-gradient(90deg, var(--sunrise), var(--lagoon)) 1; }

  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
  th, td { text-align: left; padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; }
  tbody tr:hover { background: #fcfbf7; }
  caption { color: var(--muted); font-size: 0.85rem; }

  .badge { display: inline-block; font-size: 0.8rem; font-weight: 600; padding: 0.14rem 0.55rem; border-radius: 999px; border: 1px solid var(--line); background: var(--line-soft); color: var(--ink); white-space: nowrap; }
  .badge-on_target { background: #e7f2ea; border-color: #9dc5ab; color: #1e5236; }
  .badge-warning { background: #fbf1de; border-color: #dcb87a; color: #7a5417; }
  .badge-off_target { background: #fbe9e7; border-color: #dc9a92; color: #8c2f24; }
  .badge-critical, .badge-high { background: #fbf1de; border-color: #dcb87a; color: #7a5417; }
  .pill-critical { background: #fbe9e7; border-color: #dc9a92; color: #8c2f24; }

  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.9rem; margin: 1.1rem 0 1.3rem; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.9rem 1.1rem; box-shadow: 0 1px 2px rgba(29,60,51,0.05); }
  .stat .n { font-family: Georgia, serif; font-size: 1.7rem; color: var(--pine-deep); line-height: 1.1; }
  .stat .l { color: var(--muted); font-size: 0.85rem; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.9rem; }
  a.tile { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1rem 1.15rem; text-decoration: none; color: var(--ink); box-shadow: 0 1px 2px rgba(29,60,51,0.05); }
  a.tile:hover, a.tile:focus-visible { border-color: var(--lagoon); box-shadow: 0 3px 10px rgba(31,111,107,0.14); }
  a.tile strong { color: var(--pine-deep); font-size: 1rem; display: block; margin-bottom: 0.2rem; }
  a.tile span { color: var(--muted); font-size: 0.86rem; }

  .meta { color: var(--muted); font-size: 0.83rem; }
  .notice { background: #fdf6e8; border: 1px solid #ecd096; border-radius: 10px; padding: 0.8rem 1rem; }
  details.def { margin-top: 0.25rem; }
  details.def summary { cursor: pointer; color: var(--lagoon-deep); font-size: 0.82rem; }
  details.def p { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.84rem; }

  form.stack label { display: block; margin: 0.9rem 0 0.3rem; font-weight: 600; color: var(--pine-deep); }
  input[type=email], input[type=text] { width: 100%; max-width: 24rem; padding: 0.6rem 0.7rem; border: 1px solid #b9c2bd; border-radius: 8px; font-size: 1rem; background: #fff; }
  input:focus-visible { outline: 3px solid var(--lagoon); outline-offset: 1px; border-color: var(--lagoon-deep); }
  button { background: var(--pine); color: #f6f3ec; border: 0; border-radius: 8px; padding: 0.6rem 1.3rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
  button:hover { background: var(--pine-deep); }
  button:focus-visible { outline: 3px solid var(--lagoon); outline-offset: 2px; }
  button.quiet { background: transparent; color: var(--pine-soft); border: 1px solid var(--line); margin: 0; padding: 0.4rem 0.9rem; }
  button.quiet:hover { color: var(--pine-deep); background: var(--line-soft); }
  a { color: var(--lagoon-deep); }
  a:focus-visible { outline: 3px solid var(--lagoon); outline-offset: 2px; border-radius: 3px; }

  footer.site { max-width: 64rem; margin: 0 auto 2.2rem; padding: 1rem 1.3rem 0; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); display: flex; gap: 0.6rem; align-items: center; }

  .login-wrap { min-height: 82vh; display: grid; place-items: center; }
  .login-card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 2.3rem 2.5rem 2rem; max-width: 26rem; width: 100%; box-shadow: 0 10px 32px rgba(29,60,51,0.10); text-align: center; }
  .login-card form { text-align: left; }
  .login-brand { margin: 0.9rem 0 0.1rem; font-family: Georgia, serif; font-size: 2rem; color: var(--pine); }
  .login-sub { letter-spacing: 0.34em; font-size: 0.65rem; color: var(--pine-soft); font-weight: 600; margin: 0 0 1.2rem; }
`;

export function layout(input: {
  readonly title: string;
  readonly content: string;
  readonly me?: MeView;
}): string {
  const activePath = TITLE_TO_PATH[input.title];
  const nav =
    input.me !== undefined
      ? `<nav class="site" aria-label="Main">${navFor(input.me)
          .map(
            (l) =>
              `<a href="${escapeHtml(l.href)}"${l.href === activePath ? ' aria-current="page"' : ''}>${escapeHtml(l.label)}</a>`,
          )
          .join('')}</nav>`
      : '';
  const headerEnd =
    input.me !== undefined
      ? `<div class="header-end">
  <p class="whoami"><strong>${escapeHtml(input.me.displayName)}</strong>${escapeHtml(
    input.me.assignments.map((a) => a.role.replaceAll('_', ' ')).join(', '),
  )}</p>
  <form method="post" action="/logout"><button class="quiet" type="submit">Sign out</button></form>
</div>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} — Armada Recovery</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<style>${BASE_CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <a class="brand" href="/" aria-label="Armada Recovery home">
    ${logoSvg(38)}
    <span><span class="brand-word">Armada</span><span class="brand-sub">RECOVERY</span></span>
  </a>
  ${nav}
  ${headerEnd}
</header>
<main id="main">
${input.content}
</main>
<footer class="site">${logoSvg(20)}<span>Armada Excellence OS · development environment · synthetic data only · every fact shows its source and freshness.</span></footer>
</body>
</html>
`;
}

export interface DemoUser {
  readonly email: string;
  readonly label: string;
}

export function renderLogin(error?: string, demoUsers?: readonly DemoUser[]): string {
  const alert =
    error !== undefined ? `<p class="notice" role="alert">${escapeHtml(error)}</p>` : '';
  // One-tap demo sign-in (no JavaScript: each button is its own tiny form).
  const demo =
    demoUsers !== undefined && demoUsers.length > 0
      ? `<div class="demo-block">
  <p class="meta" style="margin:1.3rem 0 0.5rem"><strong>Demo accounts</strong> — tap to sign in as a role:</p>
  ${demoUsers
    .map(
      (u) => `<form method="post" action="/login" class="demo-form">
    <input type="hidden" name="email" value="${escapeHtml(u.email)}">
    <button type="submit" class="demo-btn">${escapeHtml(u.label)}</button>
  </form>`,
    )
    .join('\n')}
</div>`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Armada Recovery</title>
<link rel="icon" href="data:image/svg+xml,${FAVICON}">
<style>${BASE_CSS}
  .demo-form { display: inline-block; margin: 0.2rem 0.25rem 0 0; }
  .demo-btn { margin: 0; padding: 0.45rem 0.85rem; background: var(--line-soft); color: var(--pine-deep); border: 1px solid var(--line); font-weight: 500; }
  .demo-btn:hover { background: #e9f2f0; border-color: var(--lagoon); }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<main id="main" class="login-wrap">
  <div class="login-card">
    ${logoSvg(72)}
    <h1 class="login-brand">Armada</h1>
    <p class="login-sub">RECOVERY</p>
    ${alert}
    ${demo}
    <form class="stack" method="post" action="/login">
      <label for="email">Work email</label>
      <input id="email" name="email" type="email" required autocomplete="username" placeholder="name@dev.armada.example">
      <button type="submit" style="width:100%">Sign in</button>
    </form>
    <p class="meta" style="margin-top:1.1rem">Development identity provider — synthetic users only.<br>Production sign-in uses the organization's SSO with MFA.</p>
  </div>
</main>
</body>
</html>
`;
}

export function renderWorkTable(items: readonly WorkItemView[], caption: string): string {
  if (items.length === 0) {
    return `<p>✓ No work items — you're clear. <span class="meta">(${escapeHtml(caption)})</span></p>`;
  }
  const rows = items
    .map(
      (i) => `<tr>
  <td><span class="badge ${i.priority === 'critical' ? 'pill-critical' : `badge-${escapeHtml(i.priority)}`}">${escapeHtml(PRIORITY_MARKS[i.priority] ?? i.priority)}</span></td>
  <td><strong>${escapeHtml(i.title)}</strong><br><span class="meta">${escapeHtml(i.explanation)}</span><br><span class="meta">→ Next action: ${escapeHtml(i.requiredAction)}</span></td>
  <td>${escapeHtml(i.status)}</td>
  <td>${escapeHtml(i.dueAt.slice(0, 16).replace('T', ' '))}</td>
  <td>${escapeHtml(i.ownerRole.replaceAll('_', ' '))}</td>
</tr>`,
    )
    .join('\n');
  return `<table>
<caption style="text-align:left;margin-bottom:0.4rem">${escapeHtml(caption)}</caption>
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
  const openCount = input.myWork.filter((i) => i.status === 'open' || i.status === 'acknowledged').length;
  const tiles = navFor(input.me)
    .filter((l) => l.href !== '/')
    .map(
      (l) =>
        `<a class="tile" href="${escapeHtml(l.href)}"><strong>${escapeHtml(l.label)}</strong><span>${escapeHtml(NAV_DESCRIPTIONS[l.href] ?? '')}</span></a>`,
    )
    .join('\n');
  const content = `
<h2>Welcome back, ${escapeHtml(input.me.displayName)}</h2>
<p class="lede">Here's what needs your attention — the correct next action, always visible.</p>
<div class="stat-row">
  <div class="stat"><div class="n">${openCount}</div><div class="l">open item(s) in view</div></div>
  <div class="stat"><div class="n">${input.notificationCount}</div><div class="l">notification(s)</div></div>
  <div class="stat"><div class="n">${input.me.assignments.length}</div><div class="l">role assignment(s)</div></div>
</div>
<section class="panel accent-top">
  <h3 style="margin-top:0">My work</h3>
  ${renderWorkTable(input.myWork, 'Top items owned by you or your role')}
  <p style="margin-bottom:0"><a href="/work">See the full queue →</a></p>
</section>
${input.panels.join('\n')}
<h3>Your workspaces</h3>
<div class="tiles">${tiles}</div>
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
    content: `<section class="panel accent-top" style="max-width:34rem"><h2 style="margin-top:0">${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><p style="margin-bottom:0"><a href="/">← Back to home</a></p></section>`,
  });
}

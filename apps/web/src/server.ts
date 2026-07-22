import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@armada/observability';
import {
  escapeHtml,
  layout,
  panel,
  renderError,
  renderHome,
  renderLogin,
  renderWorkTable,
  statusBadge,
  type MeView,
  type WorkItemView,
} from './render.js';

/**
 * Role-based web workspaces (Epic 10, ADR-0016).
 *
 * A thin server-rendered front door: every page is assembled from the same
 * policy-gated API the future rich client will use — the web app holds no
 * business logic and no data of its own (CLAUDE.md #13). The API bearer
 * token lives in an HttpOnly cookie; a 401 anywhere returns the user to
 * sign-in, and a 403 renders an honest "not available for your role" note
 * instead of pretending the feature doesn't exist.
 */

export interface WebContext {
  readonly logger: Logger;
  readonly apiBaseUrl: string;
  readonly nodeEnv: string;
}

const COOKIE_NAME = 'armada_token';

function cookieToken(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function sendHtml(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'",
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, setCookie?: string): void {
  res.writeHead(303, {
    location,
    ...(setCookie !== undefined ? { 'set-cookie': setCookie } : {}),
  });
  res.end();
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) return {};
    chunks.push(chunk as Buffer);
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

export function createWebServer(context: WebContext): Server {
  const secureCookie = context.nodeEnv === 'production' ? '; Secure' : '';

  async function api(
    token: string | undefined,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${context.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text === '' ? {} : JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { status: response.status, body };
  }

  async function requireMe(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ token: string; me: MeView } | undefined> {
    const token = cookieToken(req);
    if (token === undefined) {
      redirect(res, '/login');
      return undefined;
    }
    const result = await api(token, '/api/v1/me');
    if (result.status !== 200) {
      redirect(res, '/login', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`);
      return undefined;
    }
    return { token, me: result.body as MeView };
  }

  const routes: Record<string, Partial<Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void>>> = {
    '/health': {
      GET: (_req, res) => {
        const body = JSON.stringify({ status: 'ok', service: 'armada-web' });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
      },
    },

    '/login': {
      GET: (_req, res) => sendHtml(res, 200, renderLogin()),
      POST: async (req, res) => {
        const form = await readForm(req);
        const result = await api(undefined, '/auth/dev/login', {
          method: 'POST',
          body: { email: form['email'] ?? '' },
        });
        if (result.status !== 200) {
          sendHtml(res, 401, renderLogin('Sign-in failed. Check the address or contact your administrator.'));
          return;
        }
        const token = (result.body as { token: string }).token;
        redirect(
          res,
          '/',
          `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureCookie}`,
        );
      },
    },

    '/logout': {
      POST: async (req, res) => {
        const token = cookieToken(req);
        if (token !== undefined) await api(token, '/auth/logout', { method: 'POST' });
        redirect(res, '/login', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`);
      },
    },

    '/': {
      GET: async (req, res) => {
        // No session yet → the landing page IS the sign-in page (200, so
        // host health checks pointed at / stay green).
        if (cookieToken(req) === undefined) {
          sendHtml(res, 200, renderLogin());
          return;
        }
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const [workRes, notifRes] = await Promise.all([
          api(authed.token, '/api/v1/work-items?mine=1'),
          api(authed.token, '/api/v1/notifications'),
        ]);
        const myWork =
          workRes.status === 200
            ? ((workRes.body as { workItems: WorkItemView[] }).workItems ?? []).slice(0, 5)
            : [];
        const notifications =
          notifRes.status === 200
            ? ((notifRes.body as { notifications: unknown[] }).notifications ?? []).length
            : 0;
        const panels: string[] = [];
        const roles = new Set(authed.me.assignments.map((a) => a.role));
        if (roles.has('system_administrator')) {
          panels.push(panel('Administration', '<p><a href="/admin">Connector health and ingestion status →</a></p>'));
        }
        if (['privacy_administrator', 'compliance_administrator', 'quality_risk'].some((r) => roles.has(r))) {
          panels.push(panel('Identity review', '<p><a href="/reconciliation">Open reconciliation issues →</a></p>'));
        }
        sendHtml(
          res,
          200,
          renderHome({ me: authed.me, myWork, notificationCount: notifications, panels }),
        );
      },
    },

    '/work': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const result = await api(authed.token, '/api/v1/work-items');
        const items =
          result.status === 200 ? ((result.body as { workItems: WorkItemView[] }).workItems ?? []) : [];
        sendHtml(
          res,
          200,
          layout({
            title: 'My Work',
            me: authed.me,
            content: `<h2>Work queue</h2>${renderWorkTable(items, 'All open items in facilities you cover, sorted by priority then due time')}`,
          }),
        );
      },
    },

    '/scorecard': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const facilityId = new URL(req.url ?? '/', 'http://x').searchParams.get('facilityId');
        const result = await api(
          authed.token,
          `/api/v1/scorecards/executive-daily${facilityId !== null ? `?facilityId=${encodeURIComponent(facilityId)}` : ''}`,
        );
        if (result.status === 403) {
          sendHtml(
            res,
            403,
            renderError(
              authed.me,
              'Scorecard',
              'The organization-wide scorecard is not available for your role. Try your facility view, e.g. /scorecard?facilityId=fac-akron.',
            ),
          );
          return;
        }
        const view = result.body as {
          generatedAt: string;
          sections: {
            title: string;
            entries: {
              name: string;
              status: string;
              unit: string;
              observation: { value: number; asOf: string; provenance: { sourceSystem: string }[] } | null;
              definition: { businessQuestion: string; formula: string; ownerRole: string };
            }[];
          }[];
        };
        const sections = view.sections
          .map(
            (s) => `<section class="panel"><h3 style="margin-top:0">${escapeHtml(s.title)}</h3><table>
<thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">Status</th><th scope="col">Source · freshness</th></tr></thead>
<tbody>${s.entries
              .map((e) => {
                const value = e.observation !== null ? `${e.observation.value} ${escapeHtml(e.unit)}` : '—';
                const source =
                  e.observation !== null
                    ? `${escapeHtml(e.observation.provenance[0]?.sourceSystem ?? '')} · ${escapeHtml(e.observation.asOf.slice(0, 16).replace('T', ' '))}`
                    : 'source unavailable';
                return `<tr><td><strong>${escapeHtml(e.name)}</strong><details class="def"><summary>What is this?</summary><p>${escapeHtml(e.definition.businessQuestion)}<br>Formula: ${escapeHtml(e.definition.formula)}<br>Owner: ${escapeHtml(e.definition.ownerRole.replaceAll('_', ' '))}</p></details></td><td><strong>${value}</strong></td><td>${statusBadge(e.status)}</td><td class="meta">${source}</td></tr>`;
              })
              .join('')}</tbody></table></section>`,
          )
          .join('\n');
        sendHtml(
          res,
          200,
          layout({
            title: 'Scorecard',
            me: authed.me,
            content: `<h2>Executive daily scorecard</h2><p class="meta">Generated ${escapeHtml(view.generatedAt)} · every metric shows its definition and provenance.</p>${sections}`,
          }),
        );
      },
    },

    '/lineup': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const url = new URL(req.url ?? '/', 'http://x');
        const scoped = authed.me.assignments.find((a) => a.facilityScope !== 'all');
        const fallback =
          scoped !== undefined && scoped.facilityScope !== 'all' ? scoped.facilityScope[0] : 'fac-akron';
        const facilityId = url.searchParams.get('facilityId') ?? fallback ?? 'fac-akron';
        const result = await api(
          authed.token,
          `/api/v1/lineups/today?facilityId=${encodeURIComponent(facilityId)}`,
        );
        if (result.status !== 200) {
          sendHtml(res, result.status, renderError(authed.me, 'Daily Lineup', 'This facility lineup is not available for your role.'));
          return;
        }
        const { lineup } = result.body as {
          lineup: {
            id: string;
            date: string;
            status: string;
            items: { section: string; title: string; body: string; source?: { sourceSystem: string; asOf: string }; unavailable?: boolean }[];
          };
        };
        const items = lineup.items
          .map((i) => {
            const meta =
              i.source !== undefined
                ? `<p class="meta">Source: ${escapeHtml(i.source.sourceSystem)} · as of ${escapeHtml(i.source.asOf.slice(0, 16).replace('T', ' '))}</p>`
                : i.unavailable === true
                  ? '<p class="meta">△ Source unavailable — manual process applies</p>'
                  : '';
            return `<section class="panel"><h3 style="margin-top:0">${escapeHtml(i.title)}</h3><p>${escapeHtml(i.body).replaceAll('\n', '<br>')}</p>${meta}</section>`;
          })
          .join('\n');
        sendHtml(
          res,
          200,
          layout({
            title: 'Daily Lineup',
            me: authed.me,
            content: `<h2>Daily lineup — ${escapeHtml(facilityId)} — ${escapeHtml(lineup.date)}</h2>
<p class="meta">Status: ${escapeHtml(lineup.status)} · <a href="/lineup/print?id=${escapeHtml(lineup.id)}">printable view</a></p>${items}`,
          }),
        );
      },
    },

    '/lineup/print': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? '';
        const response = await fetch(
          `${context.apiBaseUrl}/api/v1/lineups/${encodeURIComponent(id)}/print`,
          { headers: { authorization: `Bearer ${authed.token}` } },
        );
        const html = await response.text();
        sendHtml(res, response.status, html);
      },
    },

    '/library': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const [standardsRes, constitutionRes] = await Promise.all([
          api(authed.token, '/api/v1/excellence/gold-standards'),
          api(authed.token, '/api/v1/excellence/constitution'),
        ]);
        const standards =
          standardsRes.status === 200
            ? ((standardsRes.body as { goldStandards: { contentId: string; title: string; body: { statement?: string } }[] }).goldStandards ?? [])
            : [];
        const constitution =
          constitutionRes.status === 200
            ? ((constitutionRes.body as { documents: { title: string; body: { text?: string } }[] }).documents ?? [])
            : [];
        const standardsHtml = standards
          .map(
            (s) =>
              `<tr><td><strong>${escapeHtml(s.title)}</strong><br><span class="meta">${escapeHtml(s.body.statement ?? '')}</span></td><td><a href="/library/print?id=${escapeHtml(s.contentId)}">print</a></td></tr>`,
          )
          .join('');
        const constitutionHtml = constitution
          .map((d) => `<section class="panel"><h3 style="margin-top:0">${escapeHtml(d.title)}</h3><p>${escapeHtml(d.body.text ?? '')}</p></section>`)
          .join('');
        sendHtml(
          res,
          200,
          layout({
            title: 'Excellence Library',
            me: authed.me,
            content: `<h2>Excellence Library</h2>
${constitutionHtml}
<section class="panel"><h3 style="margin-top:0">Gold Standards</h3><table><tbody>${standardsHtml}</tbody></table></section>`,
          }),
        );
      },
    },

    '/library/print': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? '';
        const response = await fetch(
          `${context.apiBaseUrl}/api/v1/excellence/content/${encodeURIComponent(id)}/print`,
          { headers: { authorization: `Bearer ${authed.token}` } },
        );
        sendHtml(res, response.status, await response.text());
      },
    },

    '/reconciliation': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const result = await api(authed.token, '/api/v1/reconciliation/issues?status=open');
        if (result.status === 403) {
          sendHtml(res, 403, renderError(authed.me, 'Identity review', 'Identity reconciliation is not available for your role.'));
          return;
        }
        const { issues } = result.body as {
          issues: { id: string; reason: string; incoming: { sourceSystem: string; sourceRecordId: string }; candidates: unknown[] }[];
        };
        const rows = issues
          .map(
            (i) =>
              `<tr><td>${escapeHtml(i.reason)}</td><td>${escapeHtml(i.incoming.sourceSystem)}/${escapeHtml(i.incoming.sourceRecordId)}</td><td>${i.candidates.length}</td></tr>`,
          )
          .join('');
        sendHtml(
          res,
          200,
          layout({
            title: 'Identity review',
            me: authed.me,
            content: `<h2>Open identity reconciliation issues</h2>
<section class="panel"><table><thead><tr><th scope="col">Reason</th><th scope="col">Incoming record</th><th scope="col">Candidates</th></tr></thead><tbody>${rows}</tbody></table>
<p class="meta">Resolution actions run through the reconciliation console API; ambiguous identities are never auto-merged.</p></section>`,
          }),
        );
      },
    },

    '/compliance': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const result = await api(authed.token, '/api/v1/compliance/readiness');
        if (result.status === 403) {
          sendHtml(res, 403, renderError(authed.me, 'Compliance', 'Compliance readiness is not available for your role.'));
          return;
        }
        const { readiness } = result.body as {
          readiness: {
            byAuthority: { authority: string; requirements: number; withEvidence: number; reviewsOverdue: number; highRiskWithoutEvidence: number }[];
            correctiveActions: { open: number; overdue: number; closed: number };
          };
        };
        const rows = readiness.byAuthority
          .map(
            (a) =>
              `<tr><td>${escapeHtml(a.authority)}</td><td>${a.requirements}</td><td>${a.withEvidence}</td><td>${a.highRiskWithoutEvidence}</td><td>${a.reviewsOverdue}</td></tr>`,
          )
          .join('');
        sendHtml(
          res,
          200,
          layout({
            title: 'Compliance readiness',
            me: authed.me,
            content: `<h2>Compliance readiness</h2>
<section class="panel"><table><thead><tr><th scope="col">Authority</th><th scope="col">Requirements</th><th scope="col">With evidence</th><th scope="col">High-risk gaps</th><th scope="col">Reviews overdue</th></tr></thead><tbody>${rows}</tbody></table>
<p class="meta">Corrective actions: ${readiness.correctiveActions.open} open · ${readiness.correctiveActions.overdue} overdue · ${readiness.correctiveActions.closed} closed. This view produces evidence for qualified review; it does not claim compliance.</p></section>`,
          }),
        );
      },
    },

    '/admin': {
      GET: async (req, res) => {
        const authed = await requireMe(req, res);
        if (authed === undefined) return;
        const result = await api(authed.token, '/api/v1/integrations/health');
        if (result.status === 403) {
          sendHtml(res, 403, renderError(authed.me, 'Integrations', 'Integration monitoring is not available for your role.'));
          return;
        }
        const { connectors } = result.body as {
          connectors: {
            name: string;
            health: { healthy: boolean };
            lastRun: { status: string; counts: { read: number; quarantined: number; deadLettered: number } } | null;
            deadLetterCount: number;
            quarantineCount: number;
          }[];
        };
        const rows = connectors
          .map(
            (c) =>
              `<tr><td>${escapeHtml(c.name)}</td><td>${c.health.healthy ? '✓ healthy' : '✗ unhealthy'}</td><td>${escapeHtml(c.lastRun?.status ?? '—')}</td><td>${c.lastRun?.counts.read ?? '—'}</td><td>${c.quarantineCount}</td><td>${c.deadLetterCount}</td></tr>`,
          )
          .join('');
        sendHtml(
          res,
          200,
          layout({
            title: 'Integrations',
            me: authed.me,
            content: `<h2>Connector health</h2>
<section class="panel"><table><thead><tr><th scope="col">Connector</th><th scope="col">Health</th><th scope="col">Last run</th><th scope="col">Read</th><th scope="col">Quarantined</th><th scope="col">Dead letters</th></tr></thead><tbody>${rows}</tbody></table>
<p class="meta">All connectors are synthetic mocks until signed vendor discovery; writes are disabled platform-wide.</p></section>`,
          }),
        );
      },
    },
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const methods = routes[url.pathname];
    const handler = methods?.[req.method ?? 'GET'];
    if (handler === undefined) {
      sendHtml(res, 404, renderError(undefined, 'Not found', 'That page does not exist.'));
      return;
    }
    Promise.resolve(handler(req, res, url)).catch((err: unknown) => {
      context.logger.error('web request failed', { path: url.pathname, err });
      if (!res.headersSent) {
        sendHtml(res, 502, renderError(undefined, 'Temporarily unavailable', 'The platform API is unreachable. Facility operations continue on downtime procedures.'));
      }
    });
  });
}

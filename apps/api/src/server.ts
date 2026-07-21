import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AuditLog } from '@armada/audit';
import {
  PURPOSES_OF_USE,
  evaluateAccess,
  generateAccessReviewReport,
  type AccessDecision,
  type BreakGlassService,
  type IdentityProvider,
  type PurposeOfUse,
  type ResourceRef,
  type SessionManager,
  type SessionRecord,
  type UserRecord,
  type UserStore,
} from '@armada/auth';
import {
  APPROVER_ROLES,
  renderPrintableHtml,
  searchPublished,
  validateBody,
  type ContentBody,
  type ExcellenceContentService,
} from '@armada/excellence';
import { newRequestId, type Logger } from '@armada/observability';
import {
  PRIORITIES,
  PRIORITY_RANK,
  RESOLUTION_CODES,
  type InMemoryNotifier,
  type Priority,
  type ResolutionCode,
  type SourceFact,
  type SourceLink,
  type WorkItemService,
  type WorkItemStatus,
} from '@armada/work';
import type { Facility } from './seed.js';

/**
 * Core domain API (Epic 2 surface).
 *
 * Every non-public route authenticates a session and passes an explicit
 * policy check (CLAUDE.md #7); denials return the decision's reason codes so
 * access failures are explainable without leaking data. Sensitive reads and
 * all mutations emit audit events (blueprint §22).
 */

export interface ApiContext {
  readonly logger: Logger;
  readonly serviceVersion: string;
  readonly nodeEnv: string;
  readonly organizationId: string;
  readonly users: UserStore;
  readonly sessions: SessionManager;
  /** Absent in production — the dev login route then answers 404. */
  readonly idp?: IdentityProvider;
  readonly breakGlass: BreakGlassService;
  readonly audit: AuditLog;
  readonly excellence: ExcellenceContentService;
  readonly work: WorkItemService;
  readonly notifier: InMemoryNotifier;
  readonly facilities: readonly Facility[];
  readonly censusByFacility: ReadonlyMap<string, number>;
}

interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly requestId: string;
  readonly log: Logger;
}

interface AuthedContext extends RequestContext {
  readonly user: UserRecord;
  readonly session: SessionRecord;
}

type Handler = (ctx: RequestContext, params: Readonly<Record<string, string>>) => Promise<void> | void;

const MAX_BODY_BYTES = 64 * 1024;

/** Match '/a/:x/b' patterns against a pathname; returns captured params. */
function matchPath(
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> | undefined {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart === undefined || pathPart === undefined) return undefined;
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return undefined;
    }
  }
  return params;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJsonBody(ctx: RequestContext): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(ctx.res, 413, { error: 'payload_too_large', requestId: ctx.requestId });
      return undefined;
    }
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(ctx.res, 400, { error: 'invalid_body', requestId: ctx.requestId });
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    sendJson(ctx.res, 400, { error: 'invalid_json', requestId: ctx.requestId });
    return undefined;
  }
}

function parsePurpose(ctx: RequestContext, fallback: PurposeOfUse): PurposeOfUse | undefined {
  const raw = ctx.url.searchParams.get('purpose');
  if (raw === null) return fallback;
  if ((PURPOSES_OF_USE as readonly string[]).includes(raw)) return raw as PurposeOfUse;
  sendJson(ctx.res, 400, { error: 'invalid_purpose', requestId: ctx.requestId });
  return undefined;
}

export function createApiServer(context: ApiContext): Server {
  const startedAt = Date.now();

  function authenticate(ctx: RequestContext): AuthedContext | undefined {
    const header = ctx.req.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      sendJson(ctx.res, 401, { error: 'unauthorized', requestId: ctx.requestId });
      return undefined;
    }
    const verification = context.sessions.verify(header.slice('Bearer '.length));
    if (!verification.ok) {
      sendJson(ctx.res, 401, {
        error: 'unauthorized',
        reason: verification.reason,
        requestId: ctx.requestId,
      });
      return undefined;
    }
    const user = context.users.getById(verification.session.userId);
    if (user === undefined || user.status !== 'active') {
      sendJson(ctx.res, 401, { error: 'unauthorized', reason: 'user_inactive', requestId: ctx.requestId });
      return undefined;
    }
    return { ...ctx, user, session: verification.session };
  }

  /**
   * Excellence content is organization-wide reading material; the policy
   * check binds it to the reader's own facility coverage (their first scoped
   * facility, or org-wide for `all`-scope roles) so the standard engine rules
   * — active user, org membership, role capability — still apply.
   */
  function excellenceResource(user: UserRecord): ResourceRef {
    const scoped = user.assignments.find(
      (a) => a.organizationId === context.organizationId && a.facilityScope !== 'all',
    );
    const facilityId =
      scoped !== undefined && scoped.facilityScope !== 'all' ? scoped.facilityScope[0] : undefined;
    return {
      type: 'excellence_content',
      classification: 'OPERATIONAL',
      organizationId: context.organizationId,
      ...(facilityId !== undefined ? { facilityId } : {}),
    };
  }

  /** Policy-check + audit a sensitive read/write. Returns the decision on ALLOW. */
  function authorize(
    ctx: AuthedContext,
    input: {
      resource: ResourceRef;
      action: 'read' | 'write';
      purpose: PurposeOfUse;
      auditAction: string;
      subjectType: string;
      subjectId: string;
      /** 'all' (default) audits every decision; 'deny-only' skips ALLOW
       * records for non-sensitive reads like the Excellence library. */
      auditMode?: 'all' | 'deny-only';
    },
  ): AccessDecision | undefined {
    const breakGlass =
      input.resource.facilityId !== undefined
        ? context.breakGlass.activeFor(ctx.user.id, input.resource.facilityId)
        : undefined;
    const decision = evaluateAccess({
      user: ctx.user,
      resource: input.resource,
      action: input.action,
      purpose: input.purpose,
      ...(breakGlass !== undefined ? { breakGlass } : {}),
    });
    if ((input.auditMode ?? 'all') === 'all' || decision.decision !== 'ALLOW') {
      context.audit.append({
        actorType: 'user',
        actorId: ctx.user.id,
        action: input.auditAction,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        organizationId: input.resource.organizationId,
        purpose: input.purpose,
        requestId: ctx.requestId,
        policyDecision: `${decision.decision}:${decision.reasonCodes.join(',')}`,
        ...(input.resource.facilityId !== undefined
          ? { facilityId: input.resource.facilityId }
          : {}),
        ...(breakGlass !== undefined ? { breakGlassReason: breakGlass.reason } : {}),
      });
    }
    if (decision.decision !== 'ALLOW') {
      sendJson(ctx.res, 403, {
        error: 'forbidden',
        reasonCodes: decision.reasonCodes,
        policyVersion: decision.policyVersion,
        requestId: ctx.requestId,
      });
      ctx.log.warn('access denied', {
        route: ctx.url.pathname,
        userId: ctx.user.id,
        reasonCodes: decision.reasonCodes,
      });
      return undefined;
    }
    return decision;
  }

  function sendHtml(res: ServerResponse, status: number, html: string): void {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  function authorizeContentRead(ctx: AuthedContext): boolean {
    return (
      authorize(ctx, {
        resource: excellenceResource(ctx.user),
        action: 'read',
        purpose: 'operations',
        auditAction: 'excellence_content.read',
        subjectType: 'excellence_content',
        subjectId: 'library',
        auditMode: 'deny-only',
      }) !== undefined
    );
  }

  function authorizeContentWrite(ctx: AuthedContext, auditAction: string, subjectId: string): boolean {
    return (
      authorize(ctx, {
        resource: excellenceResource(ctx.user),
        action: 'write',
        purpose: 'operations',
        auditAction,
        subjectType: 'excellence_content',
        subjectId,
      }) !== undefined
    );
  }

  /** Map service errors: unknown entity → 404, stale version → 409, else 400. */
  function sendServiceError(ctx: RequestContext, err: unknown): void {
    const message = err instanceof Error ? err.message : 'invalid request';
    if (message.startsWith('Unknown content') || message.startsWith('Unknown work item')) {
      sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
      return;
    }
    if (message.startsWith('Version conflict')) {
      sendJson(ctx.res, 409, { error: 'version_conflict', message, requestId: ctx.requestId });
      return;
    }
    sendJson(ctx.res, 400, { error: 'invalid_request', message, requestId: ctx.requestId });
  }

  /** Facilities this user covers (scope 'all' → every org facility). */
  function coveredFacilityIds(user: UserRecord): readonly string[] {
    const ids = new Set<string>();
    for (const a of user.assignments) {
      if (a.organizationId !== context.organizationId) continue;
      if (a.facilityScope === 'all') {
        for (const f of context.facilities) ids.add(f.id);
      } else {
        for (const id of a.facilityScope) ids.add(id);
      }
    }
    return [...ids];
  }

  /** Quiet per-facility work-item policy filter for aggregate listings. */
  function workReadAllowed(user: UserRecord, facilityId: string): boolean {
    return (
      evaluateAccess({
        user,
        resource: {
          type: 'work_item',
          classification: 'OPERATIONAL',
          organizationId: context.organizationId,
          facilityId,
        },
        action: 'read',
        purpose: 'operations',
      }).decision === 'ALLOW'
    );
  }

  /** Authorize a work-item mutation at the item's facility (audited). */
  function authorizeWorkWrite(
    ctx: AuthedContext,
    facilityId: string,
    auditAction: string,
    subjectId: string,
  ): boolean {
    return (
      authorize(ctx, {
        resource: {
          type: 'work_item',
          classification: 'OPERATIONAL',
          organizationId: context.organizationId,
          facilityId,
        },
        action: 'write',
        purpose: 'operations',
        auditAction,
        subjectType: 'work_item',
        subjectId,
      }) !== undefined
    );
  }

  function parseContentBody(ctx: RequestContext, raw: unknown): ContentBody | undefined {
    if (typeof raw !== 'object' || raw === null || typeof (raw as { kind?: unknown }).kind !== 'string') {
      sendJson(ctx.res, 400, { error: 'invalid_body', requestId: ctx.requestId });
      return undefined;
    }
    try {
      const body = raw as ContentBody;
      validateBody(body);
      return body;
    } catch (err) {
      sendServiceError(ctx, err);
      return undefined;
    }
  }

  const routes: Record<string, Partial<Record<string, Handler>>> = {
    '/health': {
      GET: (ctx) =>
        sendJson(ctx.res, 200, {
          status: 'ok',
          service: 'armada-api',
          version: context.serviceVersion,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        }),
    },
    '/ready': {
      GET: (ctx) => sendJson(ctx.res, 200, { status: 'ready' }),
    },

    '/auth/dev/login': {
      POST: async (ctx) => {
        // Fails closed: without a configured dev IdP (production) the route
        // does not exist.
        if (context.idp === undefined) {
          sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
          return;
        }
        const body = await readJsonBody(ctx);
        if (body === undefined) return;
        const email = typeof body['email'] === 'string' ? body['email'] : '';
        const principal = await context.idp.authenticate({ email });
        const user = principal !== null ? context.users.getByEmail(principal.email) : undefined;
        if (principal === null || user === undefined) {
          sendJson(ctx.res, 401, { error: 'authentication_failed', requestId: ctx.requestId });
          ctx.log.warn('dev login failed', { requestId: ctx.requestId });
          return;
        }
        const { token, session } = context.sessions.create(user.id);
        context.audit.append({
          actorType: 'user',
          actorId: user.id,
          action: 'session.created',
          subjectType: 'session',
          subjectId: session.id,
          organizationId: context.organizationId,
          requestId: ctx.requestId,
          summary: `issuer=${principal.issuer}`,
        });
        sendJson(ctx.res, 200, {
          token,
          expiresAt: session.expiresAt,
          user: {
            id: user.id,
            displayName: user.displayName,
            roles: user.assignments.map((a) => a.role),
          },
        });
      },
    },

    '/auth/logout': {
      POST: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        context.sessions.revoke(authed.session.id);
        context.audit.append({
          actorType: 'user',
          actorId: authed.user.id,
          action: 'session.revoked',
          subjectType: 'session',
          subjectId: authed.session.id,
          organizationId: context.organizationId,
          requestId: ctx.requestId,
        });
        sendJson(ctx.res, 204, {});
      },
    },

    '/api/v1/me': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const breakGlass = context.breakGlass.activeFor(authed.user.id);
        sendJson(ctx.res, 200, {
          id: authed.user.id,
          displayName: authed.user.displayName,
          email: authed.user.email,
          assignments: authed.user.assignments,
          sessionExpiresAt: authed.session.expiresAt,
          activeBreakGlass:
            breakGlass !== undefined
              ? { facilityId: breakGlass.facilityId, expiresAt: breakGlass.expiresAt }
              : null,
        });
      },
    },

    '/api/v1/facilities': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const visible = context.facilities.filter((facility) =>
          authed.user.assignments.some(
            (a) =>
              a.organizationId === facility.organizationId &&
              (a.facilityScope === 'all' || a.facilityScope.includes(facility.id)),
          ),
        );
        sendJson(ctx.res, 200, { facilities: visible });
      },
    },

    '/api/v1/patients/summary': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const facilityId = ctx.url.searchParams.get('facilityId');
        if (facilityId === null) {
          sendJson(ctx.res, 400, { error: 'facilityId_required', requestId: ctx.requestId });
          return;
        }
        const purpose = parsePurpose(ctx, 'treatment');
        if (purpose === undefined) return;
        const decision = authorize(authed, {
          resource: {
            type: 'patient_summary',
            classification: 'PHI',
            organizationId: context.organizationId,
            facilityId,
          },
          action: 'read',
          purpose,
          auditAction: 'patient_summary.read',
          subjectType: 'facility',
          subjectId: facilityId,
        });
        if (decision === undefined) return;
        sendJson(ctx.res, 200, {
          facilityId,
          censusCount: context.censusByFacility.get(facilityId) ?? 0,
          source: 'synthetic-fixture',
          asOf: new Date().toISOString(),
          obligations: decision.obligations,
        });
      },
    },

    '/api/v1/audit-events': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const facilityId = ctx.url.searchParams.get('facilityId');
        const purpose = parsePurpose(ctx, 'audit');
        if (purpose === undefined) return;
        const decision = authorize(authed, {
          resource: {
            type: 'audit_event',
            classification: 'PHI',
            organizationId: context.organizationId,
            ...(facilityId !== null ? { facilityId } : {}),
          },
          action: 'read',
          purpose,
          auditAction: 'audit_events.read',
          subjectType: 'audit_log',
          subjectId: facilityId ?? 'organization',
        });
        if (decision === undefined) return;
        const events = context.audit.query({
          ...(facilityId !== null ? { facilityId } : {}),
          limit: 100,
        });
        sendJson(ctx.res, 200, { events, integrity: context.audit.verifyIntegrity() });
      },
    },

    '/api/v1/break-glass': {
      POST: async (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const body = await readJsonBody(ctx);
        if (body === undefined) return;
        const facilityId = typeof body['facilityId'] === 'string' ? body['facilityId'] : '';
        const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
        const durationMinutes =
          typeof body['durationMinutes'] === 'number' ? body['durationMinutes'] : undefined;
        if (!context.facilities.some((f) => f.id === facilityId)) {
          sendJson(ctx.res, 400, { error: 'unknown_facility', requestId: ctx.requestId });
          return;
        }
        try {
          const activation = context.breakGlass.activate({
            user: authed.user,
            organizationId: context.organizationId,
            facilityId,
            reason,
            requestId: ctx.requestId,
            ...(durationMinutes !== undefined ? { durationMinutes } : {}),
          });
          sendJson(ctx.res, 201, {
            id: activation.id,
            facilityId: activation.facilityId,
            expiresAt: activation.expiresAt,
            notice: 'Break-glass access is monitored and queued for privacy review.',
          });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: 'break_glass_rejected',
            message: err instanceof Error ? err.message : 'invalid request',
            requestId: ctx.requestId,
          });
        }
      },
    },

    '/api/v1/access-review': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const purpose = parsePurpose(ctx, 'audit');
        if (purpose === undefined) return;
        const decision = authorize(authed, {
          resource: {
            type: 'access_review',
            classification: 'PHI',
            organizationId: context.organizationId,
          },
          action: 'read',
          purpose,
          auditAction: 'access_review.generated',
          subjectType: 'access_review',
          subjectId: 'organization',
        });
        if (decision === undefined) return;
        sendJson(
          ctx.res,
          200,
          generateAccessReviewReport({
            users: context.users.list(),
            breakGlassActivations: context.breakGlass.listForReview(),
          }),
        );
      },
    },

    '/api/v1/work-items': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const facilityId = ctx.url.searchParams.get('facilityId');
        const status = ctx.url.searchParams.get('status');
        if (status !== null && !['open', 'acknowledged', 'resolved', 'cancelled'].includes(status)) {
          sendJson(ctx.res, 400, { error: 'invalid_status', requestId: ctx.requestId });
          return;
        }
        // Single-facility requests go through the audited authorize path;
        // aggregate listings quietly filter to facilities the user may read.
        let targets: readonly string[];
        if (facilityId !== null) {
          const decision = authorize(authed, {
            resource: {
              type: 'work_item',
              classification: 'OPERATIONAL',
              organizationId: context.organizationId,
              facilityId,
            },
            action: 'read',
            purpose: 'operations',
            auditAction: 'work_items.read',
            subjectType: 'work_queue',
            subjectId: facilityId,
            auditMode: 'deny-only',
          });
          if (decision === undefined) return;
          targets = [facilityId];
        } else {
          targets = coveredFacilityIds(authed.user).filter((fid) =>
            workReadAllowed(authed.user, fid),
          );
        }
        const mine = ctx.url.searchParams.get('mine') === '1';
        const overdue = ctx.url.searchParams.get('overdue') === '1';
        const roles = authed.user.assignments.map((a) => a.role);
        const items = targets
          .flatMap((fid) =>
            context.work.listQueue({
              facilityId: fid,
              ...(status !== null ? { status: status as WorkItemStatus } : {}),
              ...(overdue ? { overdueOnly: true } : {}),
            }),
          )
          .filter(
            (item) =>
              !mine || item.ownerUserId === authed.user.id || roles.includes(item.ownerRole),
          )
          .sort(
            (a, b) =>
              PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
              Date.parse(a.dueAt) - Date.parse(b.dueAt),
          );
        sendJson(ctx.res, 200, { workItems: items });
      },
      POST: async (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const payload = await readJsonBody(ctx);
        if (payload === undefined) return;
        const facilityId = typeof payload['facilityId'] === 'string' ? payload['facilityId'] : '';
        if (!context.facilities.some((f) => f.id === facilityId)) {
          sendJson(ctx.res, 400, { error: 'unknown_facility', requestId: ctx.requestId });
          return;
        }
        if (!authorizeWorkWrite(authed, facilityId, 'work_item.create_requested', 'new')) return;
        try {
          const item = context.work.create({
            type: String(payload['type'] ?? ''),
            title: String(payload['title'] ?? ''),
            explanation: String(payload['explanation'] ?? ''),
            organizationId: context.organizationId,
            facilityId,
            subjectType: String(payload['subjectType'] ?? ''),
            subjectId: String(payload['subjectId'] ?? ''),
            priority: (PRIORITIES as readonly string[]).includes(String(payload['priority']))
              ? (payload['priority'] as Priority)
              : ('medium' as Priority),
            dueAt: String(payload['dueAt'] ?? ''),
            ownerRole: payload['ownerRole'] as never,
            ...(typeof payload['backupRole'] === 'string'
              ? { backupRole: payload['backupRole'] as never }
              : {}),
            sourceFacts: Array.isArray(payload['sourceFacts'])
              ? (payload['sourceFacts'] as SourceFact[])
              : [],
            ...(Array.isArray(payload['sourceLinks'])
              ? { sourceLinks: payload['sourceLinks'] as SourceLink[] }
              : {}),
            ...(typeof payload['standardRef'] === 'string'
              ? { standardRef: payload['standardRef'] }
              : {}),
            requiredAction: String(payload['requiredAction'] ?? ''),
            createdBy: authed.user.id,
          });
          sendJson(ctx.res, 201, { workItem: item });
        } catch (err) {
          sendServiceError(ctx, err);
        }
      },
    },

    '/api/v1/notifications': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const hasOrgWide = authed.user.assignments.some(
          (a) => a.organizationId === context.organizationId && a.facilityScope === 'all',
        );
        sendJson(ctx.res, 200, {
          notifications: context.notifier.listFor({
            roles: authed.user.assignments.map((a) => a.role),
            userId: authed.user.id,
            facilityIds: hasOrgWide ? 'all' : coveredFacilityIds(authed.user),
          }),
        });
      },
    },

    '/api/v1/excellence/gold-standards': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined || !authorizeContentRead(authed)) return;
        sendJson(ctx.res, 200, { goldStandards: context.excellence.listPublished('gold_standard') });
      },
    },

    '/api/v1/excellence/policies': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined || !authorizeContentRead(authed)) return;
        sendJson(ctx.res, 200, { policies: context.excellence.listPublished('policy') });
      },
    },

    '/api/v1/excellence/constitution': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined || !authorizeContentRead(authed)) return;
        sendJson(ctx.res, 200, {
          documents: context.excellence.listPublished('constitution_document'),
        });
      },
    },

    '/api/v1/excellence/search': {
      GET: (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined || !authorizeContentRead(authed)) return;
        const query = ctx.url.searchParams.get('q') ?? '';
        sendJson(ctx.res, 200, {
          query,
          results: searchPublished(context.excellence.listPublished(), query),
        });
      },
    },

    '/api/v1/excellence/content': {
      POST: async (ctx) => {
        const authed = authenticate(ctx);
        if (authed === undefined) return;
        const payload = await readJsonBody(ctx);
        if (payload === undefined) return;
        if (!authorizeContentWrite(authed, 'excellence_content.created', 'new')) return;
        const title = typeof payload['title'] === 'string' ? payload['title'] : '';
        const body = parseContentBody(ctx, payload['body']);
        if (body === undefined) return;
        try {
          const draft = context.excellence.createDraft({ title, body, authorId: authed.user.id });
          sendJson(ctx.res, 201, { contentId: draft.contentId, version: draft.version, status: draft.status });
        } catch (err) {
          sendServiceError(ctx, err);
        }
      },
    },
  };

  /** Shared mutation wrapper for work-item actions at the item's facility. */
  function workItemAction(
    auditAction: string,
    act: (
      ctx: AuthedContext,
      itemId: string,
      payload: Record<string, unknown>,
    ) => void,
  ): Handler {
    return async (ctx, params) => {
      const authed = authenticate(ctx);
      if (authed === undefined) return;
      const payload = await readJsonBody(ctx);
      if (payload === undefined) return;
      const itemId = params['id'] ?? '';
      const item = context.work.get(itemId);
      if (item === undefined) {
        sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
        return;
      }
      if (!authorizeWorkWrite(authed, item.facilityId, auditAction, itemId)) return;
      try {
        act(authed, itemId, payload);
      } catch (err) {
        sendServiceError(ctx, err);
      }
    };
  }

  const paramRoutes: readonly {
    readonly pattern: string;
    readonly methods: Partial<Record<string, Handler>>;
  }[] = [
    {
      pattern: '/api/v1/work-items/:id/acknowledge',
      methods: {
        POST: workItemAction('work_item.acknowledge_requested', (ctx, itemId, payload) => {
          const item = context.work.acknowledge(itemId, {
            userId: ctx.user.id,
            ...(typeof payload['expectedVersion'] === 'number'
              ? { expectedVersion: payload['expectedVersion'] }
              : {}),
          });
          sendJson(ctx.res, 200, { workItem: item });
        }),
      },
    },
    {
      pattern: '/api/v1/work-items/:id/resolve',
      methods: {
        POST: workItemAction('work_item.resolve_requested', (ctx, itemId, payload) => {
          const code = String(payload['code'] ?? '');
          if (!(RESOLUTION_CODES as readonly string[]).includes(code)) {
            sendJson(ctx.res, 400, {
              error: 'invalid_resolution_code',
              validCodes: RESOLUTION_CODES,
              requestId: ctx.requestId,
            });
            return;
          }
          const item = context.work.resolve(itemId, {
            userId: ctx.user.id,
            code: code as ResolutionCode,
            ...(typeof payload['note'] === 'string' ? { note: payload['note'] } : {}),
            ...(typeof payload['expectedVersion'] === 'number'
              ? { expectedVersion: payload['expectedVersion'] }
              : {}),
          });
          sendJson(ctx.res, 200, { workItem: item });
        }),
      },
    },
    {
      pattern: '/api/v1/work-items/:id/escalate',
      methods: {
        POST: workItemAction('work_item.escalate_requested', (ctx, itemId, payload) => {
          const item = context.work.escalate(itemId, {
            byUserId: ctx.user.id,
            ...(typeof payload['note'] === 'string' ? { note: payload['note'] } : {}),
          });
          sendJson(ctx.res, 200, { workItem: item });
        }),
      },
    },
    {
      pattern: '/api/v1/excellence/role-cards/:role',
      methods: {
        GET: (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined || !authorizeContentRead(authed)) return;
          const card = context.excellence.findPublishedRoleCard(params['role'] ?? '');
          if (card === undefined) {
            sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
            return;
          }
          sendJson(ctx.res, 200, { roleCard: card });
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id',
      methods: {
        GET: (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined || !authorizeContentRead(authed)) return;
          const contentId = params['id'] ?? '';
          const published = context.excellence.getPublished(contentId);
          if (published === undefined) {
            sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
            return;
          }
          let history: readonly { version: number; status: string }[] = [];
          try {
            history = context.excellence
              .history(contentId)
              .map((v) => ({ version: v.version, status: v.status }));
          } catch {
            history = [];
          }
          sendJson(ctx.res, 200, { content: published, history });
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id/print',
      methods: {
        GET: (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined || !authorizeContentRead(authed)) return;
          const published = context.excellence.getPublished(params['id'] ?? '');
          if (published === undefined) {
            sendJson(ctx.res, 404, { error: 'not_found', requestId: ctx.requestId });
            return;
          }
          sendHtml(ctx.res, 200, renderPrintableHtml(published));
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id/edit',
      methods: {
        POST: async (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined) return;
          const payload = await readJsonBody(ctx);
          if (payload === undefined) return;
          const contentId = params['id'] ?? '';
          if (!authorizeContentWrite(authed, 'excellence_content.edited', contentId)) return;
          const body = payload['body'] !== undefined ? parseContentBody(ctx, payload['body']) : undefined;
          if (payload['body'] !== undefined && body === undefined) return;
          try {
            const updated = context.excellence.editDraft(contentId, {
              editorId: authed.user.id,
              ...(typeof payload['title'] === 'string' ? { title: payload['title'] } : {}),
              ...(body !== undefined ? { body } : {}),
            });
            sendJson(ctx.res, 200, { contentId, version: updated.version, status: updated.status });
          } catch (err) {
            sendServiceError(ctx, err);
          }
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id/submit',
      methods: {
        POST: (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined) return;
          const contentId = params['id'] ?? '';
          if (!authorizeContentWrite(authed, 'excellence_content.submitted', contentId)) return;
          try {
            const submitted = context.excellence.submitForReview(contentId, authed.user.id);
            sendJson(ctx.res, 200, { contentId, version: submitted.version, status: submitted.status });
          } catch (err) {
            sendServiceError(ctx, err);
          }
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id/approve',
      methods: {
        POST: async (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined) return;
          const payload = await readJsonBody(ctx);
          if (payload === undefined) return;
          const contentId = params['id'] ?? '';
          if (!authorizeContentWrite(authed, 'excellence_content.approved', contentId)) return;
          const approverRole = authed.user.assignments
            .map((a) => a.role)
            .find((role) => APPROVER_ROLES.includes(role));
          if (approverRole === undefined) {
            sendJson(ctx.res, 403, {
              error: 'forbidden',
              message: 'User holds no content-approver role',
              requestId: ctx.requestId,
            });
            return;
          }
          try {
            const approved = context.excellence.approve(contentId, {
              approverId: authed.user.id,
              approverRole,
              ...(typeof payload['note'] === 'string' ? { note: payload['note'] } : {}),
            });
            sendJson(ctx.res, 200, { contentId, version: approved.version, status: approved.status });
          } catch (err) {
            sendServiceError(ctx, err);
          }
        },
      },
    },
    {
      pattern: '/api/v1/excellence/content/:id/publish',
      methods: {
        POST: (ctx, params) => {
          const authed = authenticate(ctx);
          if (authed === undefined) return;
          const contentId = params['id'] ?? '';
          if (!authorizeContentWrite(authed, 'excellence_content.published', contentId)) return;
          try {
            const published = context.excellence.publish(contentId);
            sendJson(ctx.res, 200, {
              contentId,
              version: published.version,
              status: published.status,
              publishedAt: published.publishedAt,
            });
          } catch (err) {
            sendServiceError(ctx, err);
          }
        },
      },
    },
  ];

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestId = newRequestId();
    const log = context.logger.child({ requestId });
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('x-request-id', requestId);

    let methods = routes[url.pathname];
    let params: Readonly<Record<string, string>> = {};
    if (methods === undefined) {
      for (const candidate of paramRoutes) {
        const matched = matchPath(candidate.pattern, url.pathname);
        if (matched !== undefined) {
          methods = candidate.methods;
          params = matched;
          break;
        }
      }
    }
    if (methods === undefined) {
      sendJson(res, 404, { error: 'not_found', requestId });
      return;
    }
    const handler = methods[req.method ?? 'GET'];
    if (handler === undefined) {
      sendJson(res, 405, { error: 'method_not_allowed', requestId });
      return;
    }
    Promise.resolve(handler({ req, res, url, requestId, log }, params)).catch((err: unknown) => {
      log.error('unhandled request error', { route: url.pathname, err });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', requestId });
      }
    });
  });
}

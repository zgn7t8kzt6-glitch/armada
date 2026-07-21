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
import { newRequestId, type Logger } from '@armada/observability';
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

type Handler = (ctx: RequestContext) => Promise<void> | void;

const MAX_BODY_BYTES = 16 * 1024;

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
      ...(input.resource.facilityId !== undefined ? { facilityId: input.resource.facilityId } : {}),
      ...(breakGlass !== undefined ? { breakGlassReason: breakGlass.reason } : {}),
    });
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
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestId = newRequestId();
    const log = context.logger.child({ requestId });
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('x-request-id', requestId);

    const route = routes[url.pathname];
    if (route === undefined) {
      sendJson(res, 404, { error: 'not_found', requestId });
      return;
    }
    const handler = route[req.method ?? 'GET'];
    if (handler === undefined) {
      sendJson(res, 405, { error: 'method_not_allowed', requestId });
      return;
    }
    Promise.resolve(handler({ req, res, url, requestId, log })).catch((err: unknown) => {
      log.error('unhandled request error', { route: url.pathname, err });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', requestId });
      }
    });
  });
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { newRequestId, type Logger } from '@armada/observability';

export interface ApiServerOptions {
  readonly logger: Logger;
  readonly serviceVersion: string;
}

interface JsonBody {
  readonly [key: string]: unknown;
}

function sendJson(res: ServerResponse, status: number, body: JsonBody): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    // Secure-by-default headers even for this placeholder service.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  });
  res.end(data);
}

/**
 * Placeholder HTTP service for the core domain API.
 *
 * Real routes arrive with later epics behind explicit authorization checks
 * (CLAUDE.md #7). Until then only unauthenticated liveness/readiness probes
 * exist — they expose no data beyond service name and version.
 */
export function createApiServer(options: ApiServerOptions): Server {
  const startedAt = Date.now();

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestId = newRequestId();
    const log = options.logger.child({ requestId });
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${method} ${url.pathname}`;

    res.setHeader('x-request-id', requestId);

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', requestId });
      log.warn('request rejected', { route, status: 405 });
      return;
    }

    switch (url.pathname) {
      case '/health': {
        sendJson(res, 200, {
          status: 'ok',
          service: 'armada-api',
          version: options.serviceVersion,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        });
        return;
      }
      case '/ready': {
        // Later epics add dependency checks (database, cache) here.
        sendJson(res, 200, { status: 'ready' });
        return;
      }
      default: {
        sendJson(res, 404, { error: 'not_found', requestId });
        log.info('request not matched', { route, status: 404 });
        return;
      }
    }
  });
}

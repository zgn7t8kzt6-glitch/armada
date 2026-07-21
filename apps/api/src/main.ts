import {
  BreakGlassService,
  DevIdentityProvider,
  InMemoryUserStore,
  SessionManager,
} from '@armada/auth';
import { InMemoryAuditLog } from '@armada/audit';
import { ExcellenceContentService, seedExcellenceContent } from '@armada/excellence';
import { createLogger } from '@armada/observability';
import { DEV_SESSION_SECRET_DEFAULT, loadApiEnv } from './env.js';
import { createFlags } from './flags.js';
import { seedSyntheticDirectory } from './seed.js';
import { createApiServer } from './server.js';

const SERVICE_VERSION = '0.2.0';

function main(): void {
  // Fail fast: invalid configuration must abort startup before anything binds.
  const env = loadApiEnv();
  const logger = createLogger({ service: 'armada-api', level: env.LOG_LEVEL });
  const flags = createFlags(env.NODE_ENV, logger);
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && env.SESSION_SECRET === DEV_SESSION_SECRET_DEFAULT) {
    throw new Error('SESSION_SECRET must be set to a vault-managed value in production');
  }

  const users = new InMemoryUserStore();
  const sessions = new SessionManager({
    secret: env.SESSION_SECRET,
    ttlMinutes: env.SESSION_TTL_MINUTES,
  });
  const audit = new InMemoryAuditLog();
  const breakGlass = new BreakGlassService({ audit });

  // Synthetic directory and passwordless dev IdP exist only below production.
  // Production identity arrives with real OIDC SSO (ADR-0006); until then a
  // production boot serves health checks and nothing else.
  const directory = isProduction
    ? { organizationId: 'org-armada', facilities: [], censusByFacility: new Map<string, number>() }
    : seedSyntheticDirectory(users);
  const idp = isProduction
    ? undefined
    : new DevIdentityProvider({
        nodeEnv: env.NODE_ENV,
        lookupByEmail: (email) => users.getByEmail(email),
      });

  // Starter Excellence content ships only with the synthetic directory; real
  // content is authored and approved through the workflow endpoints.
  const excellence = new ExcellenceContentService();
  if (!isProduction) {
    const author = users.getByEmail('quality@dev.armada.example');
    const approver = users.getByEmail('executive@dev.armada.example');
    if (author !== undefined && approver !== undefined) {
      seedExcellenceContent(excellence, {
        authorId: author.id,
        approverId: approver.id,
        approverRole: 'executive',
      });
    }
  }

  const server = createApiServer({
    logger,
    serviceVersion: SERVICE_VERSION,
    nodeEnv: env.NODE_ENV,
    organizationId: directory.organizationId,
    users,
    sessions,
    ...(idp !== undefined ? { idp } : {}),
    breakGlass,
    audit,
    excellence,
    facilities: directory.facilities,
    censusByFacility: directory.censusByFacility,
  });

  server.listen(env.API_PORT, env.API_HOST, () => {
    logger.info('api listening', {
      host: env.API_HOST,
      port: env.API_PORT,
      nodeEnv: env.NODE_ENV,
      devIdpEnabled: idp !== undefined,
      flags: flags.snapshot().map((f) => ({ name: f.definition.name, enabled: f.enabled })),
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    // Do not hang forever on stuck connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

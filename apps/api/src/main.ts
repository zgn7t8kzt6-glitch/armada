import {
  BreakGlassService,
  DevIdentityProvider,
  InMemoryUserStore,
  SessionManager,
} from '@armada/auth';
import { InMemoryAuditLog } from '@armada/audit';
import { createMockCollaborateMdConnector, collaborateMdMappingRegistrations } from '@armada/connector-collaboratemd';
import { createMockKipuConnector, kipuMappingRegistrations } from '@armada/connector-kipu';
import { createMockSalesforceConnector, salesforceMappingRegistrations } from '@armada/connector-salesforce';
import { ExcellenceContentService, seedExcellenceContent } from '@armada/excellence';
import { IdentityService, seedIdentityScenarios } from '@armada/identity';
import {
  IngestionPipeline,
  InMemoryIngestedRecordStore,
  MappingRegistry,
  type SourceConnector,
} from '@armada/integrations-core';
import { createLogger } from '@armada/observability';
import { InMemoryNotifier, WorkItemService, seedWorkItems } from '@armada/work';
import { DEV_SESSION_SECRET_DEFAULT, loadApiEnv } from './env.js';
import { wireMetrics } from './metricsSetup.js';
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

  const identity = new IdentityService({ audit });
  if (!isProduction && directory.facilities.length >= 2) {
    seedIdentityScenarios(identity, {
      akron: directory.facilities[0]!.id,
      columbus: directory.facilities[1]!.id,
    });
  }

  const notifier = new InMemoryNotifier();
  const work = new WorkItemService({ audit, notifier });
  if (!isProduction) {
    const creator = users.getByEmail('quality@dev.armada.example');
    if (creator !== undefined && directory.facilities.length >= 2) {
      seedWorkItems(work, {
        organizationId: directory.organizationId,
        akronFacilityId: directory.facilities[0]!.id,
        columbusFacilityId: directory.facilities[1]!.id,
        createdBy: creator.id,
      });
    }
  }

  // Mock connectors + ingestion pipeline: development only. Production gets
  // real connectors after signed vendor discovery (docs/integrations/).
  let integrations:
    | {
        pipeline: IngestionPipeline;
        connectors: readonly SourceConnector[];
        store: InMemoryIngestedRecordStore;
      }
    | undefined;
  if (!isProduction) {
    const mappings = new MappingRegistry();
    for (const registration of [
      ...kipuMappingRegistrations(),
      ...salesforceMappingRegistrations(),
      ...collaborateMdMappingRegistrations(),
    ]) {
      mappings.register(registration);
    }
    const ingestStore = new InMemoryIngestedRecordStore();
    const pipeline = new IngestionPipeline({
      audit,
      store: ingestStore,
      mappings,
      onAnomaly: (run, previousReads) => {
        // Volume anomalies become owned, explained work items (§25).
        work.create({
          type: 'integration.volume_anomaly',
          title: `Ingestion volume anomaly on ${run.connectorName}`,
          explanation:
            'Record volume changed sharply versus the previous run; source outage, cursor fault, or upstream change may be corrupting operational data.',
          organizationId: directory.organizationId,
          facilityId: directory.facilities[0]?.id ?? 'org',
          subjectType: 'ingestion_run',
          subjectId: run.runId,
          priority: 'high',
          dueAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
          ownerRole: 'system_administrator',
          sourceFacts: [
            {
              label: 'Records read this run',
              value: String(run.counts.read),
              sourceSystem: run.connectorName,
              sourceTimestamp: run.finishedAt,
            },
            {
              label: 'Records read previous run',
              value: String(previousReads),
              sourceSystem: run.connectorName,
              sourceTimestamp: run.startedAt,
            },
          ],
          requiredAction: 'Check connector health and reconcile counts before trusting dashboards.',
          createdBy: 'ingestion-pipeline',
        });
      },
    });
    const connectors: readonly SourceConnector[] = [
      createMockKipuConnector({ facilityIds: directory.facilities.map((f) => f.id) }),
      createMockSalesforceConnector(),
      createMockCollaborateMdConnector(),
    ];
    integrations = { pipeline, connectors, store: ingestStore };
  }

  const metrics = wireMetrics({
    audit,
    work,
    ...(integrations !== undefined ? { ingestStore: integrations.store } : {}),
    facilities: directory.facilities,
    seedActors: {
      definedBy: users.getByEmail('quality@dev.armada.example')?.id ?? 'governance',
      approvedBy: users.getByEmail('executive@dev.armada.example')?.id ?? 'executive-sponsor',
    },
  });

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
    work,
    notifier,
    identity,
    metrics,
    ...(integrations !== undefined ? { integrations } : {}),
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

  // Mock ingestion: initial run at boot, then refresh on an interval.
  // Moves to apps/worker once services share durable storage (database epic).
  let ingestTimer: NodeJS.Timeout | undefined;
  if (integrations !== undefined) {
    const { pipeline, connectors } = integrations;
    const runAll = (): void => {
      void Promise.all(connectors.map((connector) => pipeline.run(connector))).then((runs) => {
        logger.info('ingestion cycle complete', {
          runs: runs.map((r) => ({
            connector: r.connectorName,
            status: r.status,
            read: r.counts.read,
            created: r.counts.created,
            quarantined: r.counts.quarantined,
          })),
        });
      });
    };
    runAll();
    ingestTimer = setInterval(runAll, 5 * 60_000);
    ingestTimer.unref();
  }

  // Escalation sweep: overdue work items climb the role ladder every minute.
  // Moves to apps/worker once services share durable storage (database epic).
  const sweep = setInterval(() => {
    const escalated = work.sweepEscalations();
    if (escalated.length > 0) {
      logger.info('work items escalated', {
        count: escalated.length,
        ids: escalated.map((i) => i.id),
      });
    }
  }, 60_000);
  sweep.unref();

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    clearInterval(sweep);
    if (ingestTimer !== undefined) clearInterval(ingestTimer);
    server.close(() => process.exit(0));
    // Do not hang forever on stuck connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

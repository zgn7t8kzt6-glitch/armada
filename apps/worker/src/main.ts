import { baseSchema, loadEnv } from '@armada/env';
import { createLogger } from '@armada/observability';
import { createScheduler } from './scheduler.js';

const workerEnvSchema = {
  ...baseSchema,
  WORKER_HEARTBEAT_MS: {
    kind: 'integer',
    min: 1000,
    max: 3_600_000,
    default: 60_000,
    description: 'Heartbeat interval for the placeholder worker loop',
  },
} as const;

function main(): void {
  const env = loadEnv(workerEnvSchema);
  const logger = createLogger({ service: 'armada-worker', level: env.LOG_LEVEL });

  // Placeholder heartbeat only. Ingestion, reconciliation, and alert jobs
  // arrive with Epic 5 behind the connector SDK.
  const scheduler = createScheduler({
    logger,
    intervalMs: env.WORKER_HEARTBEAT_MS,
    handler: (tick) => {
      logger.debug('heartbeat', { tick });
    },
  });

  scheduler.start();
  logger.info('worker started', { nodeEnv: env.NODE_ENV });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    void scheduler.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

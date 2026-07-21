import { createLogger } from '@armada/observability';
import { loadApiEnv } from './env.js';
import { createFlags } from './flags.js';
import { createApiServer } from './server.js';

const SERVICE_VERSION = '0.1.0';

function main(): void {
  // Fail fast: invalid configuration must abort startup before anything binds.
  const env = loadApiEnv();
  const logger = createLogger({ service: 'armada-api', level: env.LOG_LEVEL });
  const flags = createFlags(env.NODE_ENV, logger);

  const server = createApiServer({ logger, serviceVersion: SERVICE_VERSION });

  server.listen(env.API_PORT, env.API_HOST, () => {
    logger.info('api listening', {
      host: env.API_HOST,
      port: env.API_PORT,
      nodeEnv: env.NODE_ENV,
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

import { baseSchema, loadEnv } from '@armada/env';
import { createLogger } from '@armada/observability';
import { createWebServer } from './server.js';

const webEnvSchema = {
  ...baseSchema,
  WEB_PORT: { kind: 'port', default: 3100, description: 'Web HTTP listen port' },
  WEB_HOST: {
    kind: 'string',
    default: '127.0.0.1',
    description: 'Web HTTP listen host (bind 0.0.0.0 only inside a container)',
  },
  API_BASE_URL: {
    kind: 'url',
    protocols: ['http:', 'https:'],
    default: 'http://127.0.0.1:3000',
    description: 'Base URL of the Armada API this web app renders from',
  },
} as const;

function main(): void {
  const env = loadEnv(webEnvSchema);
  const logger = createLogger({ service: 'armada-web', level: env.LOG_LEVEL });
  const server = createWebServer({
    logger,
    apiBaseUrl: env.API_BASE_URL,
    nodeEnv: env.NODE_ENV,
  });
  server.listen(env.WEB_PORT, env.WEB_HOST, () => {
    logger.info('web listening', {
      host: env.WEB_HOST,
      port: env.WEB_PORT,
      apiBaseUrl: env.API_BASE_URL,
      nodeEnv: env.NODE_ENV,
    });
  });
  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

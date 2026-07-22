import { baseSchema, loadEnv, type EnvOutput } from '@armada/env';

/**
 * Development fallback for the session-signing secret. main.ts refuses to
 * boot in production while this value is in use.
 */
export const DEV_SESSION_SECRET_DEFAULT = 'dev-only-session-secret-never-use-in-production';

export const apiEnvSchema = {
  ...baseSchema,
  API_PORT: { kind: 'port', default: 3000, description: 'HTTP listen port' },
  API_HOST: {
    kind: 'string',
    default: '127.0.0.1',
    description: 'HTTP listen host (bind 0.0.0.0 only inside a container)',
  },
  SESSION_SECRET: {
    kind: 'string',
    secret: true,
    default: DEV_SESSION_SECRET_DEFAULT,
    description: 'HMAC key for session tokens (>= 32 chars; vault-managed in production)',
  },
  SESSION_TTL_MINUTES: {
    kind: 'integer',
    min: 5,
    max: 480,
    default: 30,
    description: 'Session lifetime; no refresh — users re-authenticate after expiry',
  },
} as const;

export type ApiEnv = EnvOutput<typeof apiEnvSchema>;

export function loadApiEnv(source?: Record<string, string | undefined>): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}

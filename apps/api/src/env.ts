import { baseSchema, loadEnv, type EnvOutput } from '@armada/env';

export const apiEnvSchema = {
  ...baseSchema,
  API_PORT: { kind: 'port', default: 3000, description: 'HTTP listen port' },
  API_HOST: {
    kind: 'string',
    default: '127.0.0.1',
    description: 'HTTP listen host (bind 0.0.0.0 only inside a container)',
  },
} as const;

export type ApiEnv = EnvOutput<typeof apiEnvSchema>;

export function loadApiEnv(source?: Record<string, string | undefined>): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}

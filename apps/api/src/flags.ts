import { createFlagRegistry, type FlagDefinition, type FlagRegistry } from '@armada/feature-flags';
import type { Logger } from '@armada/observability';

/**
 * Platform-wide flag definitions. Every entry defaults OFF.
 * Adding a high-risk flag requires an ADR and the relevant blueprint gate.
 */
export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  {
    name: 'CONNECTOR_WRITE_BACK',
    description:
      'Vendor write paths (blueprint Phase 2 gate — signed risk assessment required). Reserved; no write code exists yet.',
    risk: 'high',
    owner: 'security-lead',
  },
];

export function createFlags(nodeEnv: string, logger: Logger): FlagRegistry {
  return createFlagRegistry(FLAG_DEFINITIONS, {
    nodeEnv,
    onIgnoredOverride: (flag, reason) =>
      logger.warn('feature flag override ignored', { flag, reason }),
  });
}

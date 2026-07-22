/**
 * Feature flag registry.
 *
 * Blueprint rules (CLAUDE.md #11): incomplete, write-back, and high-risk
 * functionality ships behind flags that default OFF. High-risk flags can never
 * be enabled through an environment override in production — enabling them
 * requires a separately approved release (a code change reviewed under the
 * governance process), so there is no quiet toggle for dangerous behavior.
 */

export type FlagRisk = 'standard' | 'high';

export interface FlagDefinition {
  /** SCREAMING_SNAKE_CASE identifier, e.g. `CONNECTOR_WRITE_BACK`. */
  readonly name: string;
  readonly description: string;
  /** High-risk flags (write-back, clinical, financial) get extra guardrails. */
  readonly risk: FlagRisk;
  /** Owner role accountable for the flag (not a person). */
  readonly owner: string;
}

export interface FlagRegistryOptions {
  /** Resolved NODE_ENV tier, from @armada/env. */
  readonly nodeEnv: string;
  /** Environment source for overrides; defaults to process.env. */
  readonly source?: Record<string, string | undefined>;
  /** Called when an override is ignored (e.g. high-risk flag in production). */
  readonly onIgnoredOverride?: (flag: string, reason: string) => void;
}

export interface FlagState {
  readonly definition: FlagDefinition;
  readonly enabled: boolean;
  /** Where the value came from. */
  readonly resolvedFrom: 'default' | 'env-override';
}

export const FLAG_ENV_PREFIX = 'ARMADA_FLAG_';

const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

export class FlagRegistry {
  readonly #states = new Map<string, FlagState>();

  constructor(definitions: readonly FlagDefinition[], options: FlagRegistryOptions) {
    const source = options.source ?? process.env;
    for (const definition of definitions) {
      if (!NAME_PATTERN.test(definition.name)) {
        throw new Error(`Invalid flag name "${definition.name}": use SCREAMING_SNAKE_CASE`);
      }
      if (this.#states.has(definition.name)) {
        throw new Error(`Duplicate flag definition: ${definition.name}`);
      }
      this.#states.set(definition.name, resolveFlag(definition, options, source));
    }
  }

  /** Unknown flags are a programming error, not a silent false. */
  isEnabled(name: string): boolean {
    const state = this.#states.get(name);
    if (state === undefined) {
      throw new Error(`Unknown feature flag: ${name}`);
    }
    return state.enabled;
  }

  /** Full resolved state, e.g. for an admin/diagnostics endpoint. */
  snapshot(): readonly FlagState[] {
    return [...this.#states.values()];
  }
}

function resolveFlag(
  definition: FlagDefinition,
  options: FlagRegistryOptions,
  source: Record<string, string | undefined>,
): FlagState {
  const raw = source[`${FLAG_ENV_PREFIX}${definition.name}`];
  if (raw === undefined || raw.trim() === '') {
    return { definition, enabled: false, resolvedFrom: 'default' };
  }

  const normalized = raw.trim().toLowerCase();
  let requested: boolean;
  if (TRUE_VALUES.has(normalized)) {
    requested = true;
  } else if (FALSE_VALUES.has(normalized)) {
    requested = false;
  } else {
    throw new Error(
      `Invalid value for ${FLAG_ENV_PREFIX}${definition.name}: expected true/false`,
    );
  }

  if (requested && definition.risk === 'high' && options.nodeEnv === 'production') {
    options.onIgnoredOverride?.(
      definition.name,
      'high-risk flags cannot be enabled via environment override in production',
    );
    return { definition, enabled: false, resolvedFrom: 'default' };
  }

  return { definition, enabled: requested, resolvedFrom: 'env-override' };
}

export function createFlagRegistry(
  definitions: readonly FlagDefinition[],
  options: FlagRegistryOptions,
): FlagRegistry {
  return new FlagRegistry(definitions, options);
}

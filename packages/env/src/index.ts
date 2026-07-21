/**
 * Typed, fail-fast environment validation.
 *
 * Apps must never read `process.env` directly; they declare a schema and call
 * `loadEnv`. Invalid configuration aborts startup with every problem listed at
 * once. Values of variables marked `secret` are never echoed in error output.
 */

export type NodeEnv = 'development' | 'test' | 'staging' | 'production';

export const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'staging', 'production'];

interface BaseVar<T> {
  /** Human explanation shown in error messages and generated docs. */
  readonly description: string;
  /** When set, a missing variable falls back to this value instead of failing. */
  readonly default?: T;
  /** Secret values are redacted from all error messages and summaries. */
  readonly secret?: boolean;
}

export interface StringVar extends BaseVar<string> {
  readonly kind: 'string';
  /** Reject empty strings (default true). */
  readonly nonEmpty?: boolean;
}

export interface IntegerVar extends BaseVar<number> {
  readonly kind: 'integer';
  readonly min?: number;
  readonly max?: number;
}

export interface PortVar extends BaseVar<number> {
  readonly kind: 'port';
}

export interface BooleanVar extends BaseVar<boolean> {
  readonly kind: 'boolean';
}

export interface EnumVar<T extends string = string> extends BaseVar<T> {
  readonly kind: 'enum';
  readonly values: readonly T[];
}

export interface UrlVar extends BaseVar<string> {
  readonly kind: 'url';
  /** Restrict accepted protocols, e.g. ['postgresql:', 'redis:']. */
  readonly protocols?: readonly string[];
}

export type EnvVarSpec = StringVar | IntegerVar | PortVar | BooleanVar | EnumVar | UrlVar;

export type EnvSchema = Record<string, EnvVarSpec>;

type VarOutput<S extends EnvVarSpec> = S extends IntegerVar | PortVar
  ? number
  : S extends BooleanVar
    ? boolean
    : S extends EnumVar<infer T>
      ? T
      : string;

export type EnvOutput<S extends EnvSchema> = { readonly [K in keyof S]: VarOutput<S[K]> };

export interface EnvProblem {
  readonly name: string;
  readonly message: string;
}

export class EnvValidationError extends Error {
  readonly problems: readonly EnvProblem[];

  constructor(problems: readonly EnvProblem[]) {
    const lines = problems.map((p) => `  - ${p.name}: ${p.message}`);
    super(`Environment validation failed:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function describeRaw(raw: string, spec: EnvVarSpec): string {
  return spec.secret === true ? '<redacted>' : JSON.stringify(raw);
}

function parseVar(name: string, raw: string, spec: EnvVarSpec): { value?: unknown; problem?: EnvProblem } {
  switch (spec.kind) {
    case 'string': {
      if ((spec.nonEmpty ?? true) && raw.trim() === '') {
        return { problem: { name, message: 'must not be empty' } };
      }
      return { value: raw };
    }
    case 'integer':
    case 'port': {
      if (!/^-?\d+$/.test(raw.trim())) {
        return { problem: { name, message: `expected an integer, got ${describeRaw(raw, spec)}` } };
      }
      const n = Number(raw.trim());
      const min = spec.kind === 'port' ? 1 : spec.min;
      const max = spec.kind === 'port' ? 65535 : spec.max;
      if (min !== undefined && n < min) {
        return { problem: { name, message: `must be >= ${min}, got ${describeRaw(raw, spec)}` } };
      }
      if (max !== undefined && n > max) {
        return { problem: { name, message: `must be <= ${max}, got ${describeRaw(raw, spec)}` } };
      }
      return { value: n };
    }
    case 'boolean': {
      const v = raw.trim().toLowerCase();
      if (TRUE_VALUES.has(v)) return { value: true };
      if (FALSE_VALUES.has(v)) return { value: false };
      return {
        problem: { name, message: `expected true/false (or 1/0, yes/no, on/off), got ${describeRaw(raw, spec)}` },
      };
    }
    case 'enum': {
      if (!spec.values.includes(raw)) {
        return {
          problem: {
            name,
            message: `expected one of [${spec.values.join(', ')}], got ${describeRaw(raw, spec)}`,
          },
        };
      }
      return { value: raw };
    }
    case 'url': {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return { problem: { name, message: `expected a valid URL, got ${describeRaw(raw, spec)}` } };
      }
      if (spec.protocols !== undefined && !spec.protocols.includes(parsed.protocol)) {
        return {
          problem: {
            name,
            message: `URL protocol must be one of [${spec.protocols.join(', ')}], got "${parsed.protocol}"`,
          },
        };
      }
      return { value: raw };
    }
  }
}

/**
 * Validate `source` (defaults to `process.env`) against `schema`.
 * Collects every problem before throwing so operators fix configuration once.
 */
export function loadEnv<S extends EnvSchema>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): EnvOutput<S> {
  const problems: EnvProblem[] = [];
  const output: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(schema)) {
    const raw = source[name];
    if (raw === undefined || raw === '') {
      if (spec.default !== undefined) {
        output[name] = spec.default;
      } else if (raw === undefined) {
        problems.push({ name, message: `required (${spec.description})` });
      } else {
        problems.push({ name, message: `must not be empty (${spec.description})` });
      }
      continue;
    }
    const result = parseVar(name, raw, spec);
    if (result.problem !== undefined) {
      problems.push(result.problem);
    } else {
      output[name] = result.value;
    }
  }

  if (problems.length > 0) {
    throw new EnvValidationError(problems);
  }
  return output as EnvOutput<S>;
}

/** Shared schema fragment every app includes. */
export const baseSchema = {
  NODE_ENV: {
    kind: 'enum',
    values: NODE_ENVS,
    default: 'development' as const,
    description: 'Runtime environment tier',
  },
  LOG_LEVEL: {
    kind: 'enum',
    values: ['debug', 'info', 'warn', 'error'] as const,
    default: 'info' as const,
    description: 'Minimum log level emitted',
  },
} satisfies EnvSchema;

/** True when the resolved NODE_ENV is the production tier. */
export function isProduction(env: { NODE_ENV: string }): boolean {
  return env.NODE_ENV === 'production';
}

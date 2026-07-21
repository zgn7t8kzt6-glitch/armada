/**
 * PHI-safe structured logging.
 *
 * Blueprint rules (CLAUDE.md #5, §22): no PHI or Part 2 payloads in logs.
 * Defense in depth:
 *  - structured JSON lines only — no free-form string interpolation of data;
 *  - field keys matching a sensitive-name deny list are redacted recursively;
 *  - `payload` / `body` / raw-record style keys are always redacted, so
 *    ingested vendor payloads can never leak through a log call;
 *  - long strings are truncated to keep accidental dumps small;
 *  - loggers carry stable internal references (request IDs, internal UUIDs),
 *    never source-record content.
 *
 * This is intentionally not a full OpenTelemetry setup; it is the seam where
 * OTel exporters attach in a later epic (sink abstraction).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly level: LogLevel;
  readonly time: string;
  readonly service: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

export type LogSink = (line: string, record: LogRecord) => void;

export interface LoggerOptions {
  readonly service: string;
  readonly level?: LogLevel;
  /** Defaults to writing JSON lines to stdout. */
  readonly sink?: LogSink;
  /** Extra deny-listed key fragments beyond the built-in set. */
  readonly extraSensitiveKeys?: readonly string[];
  /** Fields bound to every record (request IDs, connector name, ...). */
  readonly bindings?: LogFields;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** New logger with additional bound fields (bindings are sanitized too). */
  child(bindings: LogFields): Logger;
}

export const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 6;

/**
 * Key-name fragments treated as sensitive. Matching is case-insensitive and
 * substring-based ("patientName", "PATIENT_DOB", "ssn4" all match).
 * The list is deliberately broad: a false-positive redaction is a nuisance,
 * a false negative is a reportable incident.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  'payload',
  'body',
  'rawrecord',
  'ssn',
  'social_security',
  'dob',
  'dateofbirth',
  'birth',
  'firstname',
  'lastname',
  'first_name',
  'last_name',
  'fullname',
  'full_name',
  'legalname',
  'legal_name',
  'patient',
  'diagnos',
  'medication',
  'clinical',
  'treatment',
  'phone',
  'email',
  'address',
  'street',
  'zip',
  'postal',
  'mrn',
  'medicalrecord',
  'medical_record',
  'member_id',
  'memberid',
  'insurance',
  'policy_number',
  'policynumber',
  'guarantor',
  'nextofkin',
  'next_of_kin',
  'emergencycontact',
  'emergency_contact',
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization_header',
  'credential',
];

function isSensitiveKey(key: string, extra: readonly string[]): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const compact = normalized.replace(/_/g, '');
  return [...SENSITIVE_KEY_FRAGMENTS, ...extra].some((fragment) => {
    const f = fragment.toLowerCase();
    return normalized.includes(f) || compact.includes(f.replace(/_/g, ''));
  });
}

function sanitizeValue(value: unknown, extra: readonly string[], depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeValue(value.message, extra, depth + 1),
      stack: typeof value.stack === 'string' ? value.stack.split('\n').slice(0, 10).join('\n') : undefined,
    };
  }
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, extra, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key, extra) ? REDACTED : sanitizeValue(inner, extra, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Sanitize a top-level field map: redact sensitive keys, bound depth/size. */
export function sanitizeFields(fields: LogFields, extra: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isSensitiveKey(key, extra) ? REDACTED : sanitizeValue(value, extra, 1);
  }
  return out;
}

const RESERVED_KEYS = new Set(['level', 'time', 'service', 'message']);

const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

class StructuredLogger implements Logger {
  readonly #options: Required<Pick<LoggerOptions, 'service' | 'level' | 'sink' | 'now'>> & {
    readonly extraSensitiveKeys: readonly string[];
  };
  readonly #bindings: Record<string, unknown>;

  constructor(options: LoggerOptions, inheritedBindings: Record<string, unknown> = {}) {
    this.#options = {
      service: options.service,
      level: options.level ?? 'info',
      sink: options.sink ?? defaultSink,
      now: options.now ?? (() => new Date()),
      extraSensitiveKeys: options.extraSensitiveKeys ?? [],
    };
    this.#bindings = {
      ...inheritedBindings,
      ...(options.bindings !== undefined
        ? sanitizeFields(options.bindings, this.#options.extraSensitiveKeys)
        : {}),
    };
  }

  #emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#options.level]) return;
    const sanitized = fields !== undefined ? sanitizeFields(fields, this.#options.extraSensitiveKeys) : {};
    for (const key of Object.keys(sanitized)) {
      if (RESERVED_KEYS.has(key)) delete sanitized[key];
    }
    const record: LogRecord = {
      level,
      time: this.#options.now().toISOString(),
      service: this.#options.service,
      message,
      ...this.#bindings,
      ...sanitized,
    };
    this.#options.sink(JSON.stringify(record), record);
  }

  debug(message: string, fields?: LogFields): void {
    this.#emit('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.#emit('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.#emit('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.#emit('error', message, fields);
  }

  child(bindings: LogFields): Logger {
    return new StructuredLogger({ ...this.#options, bindings }, this.#bindings);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new StructuredLogger(options);
}

/** Generate a request/correlation ID (stable internal reference, never PHI). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

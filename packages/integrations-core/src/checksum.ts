import { createHash } from 'node:crypto';

/** Deterministic JSON serialization (sorted object keys, recursive). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** Envelope checksum: sha256 over the stable serialization of the payload. */
export function computeChecksum(payload: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

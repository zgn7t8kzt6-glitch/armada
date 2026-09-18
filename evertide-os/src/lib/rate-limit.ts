import "server-only";

// Conservative application-level rate limiter for sensitive mutations
// (spec §11.9). Fixed-window counter per (user, action) held in module
// memory. On serverless this is per-instance, which still bounds abuse from
// a single warm instance; the database's own constraints and RLS are the
// hard backstop. Documented in README → Implementation Decisions.
const WINDOW_MS = 60_000;
const buckets = new Map<string, { windowStart: number; count: number }>();

export function checkRateLimit(userId: string, action: string, maxPerMinute = 30): void {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > maxPerMinute) {
    throw new Error("Rate limit exceeded — please slow down and try again shortly.");
  }
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (now - v.windowStart >= WINDOW_MS) buckets.delete(k);
    }
  }
}

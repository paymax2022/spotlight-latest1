// Lightweight in-process rate limiter using a sliding-window token bucket.
// For production at scale replace with a Redis-backed limiter (e.g. Upstash).

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const store = new Map<string, Bucket>();

// Hard cap on distinct keys — an attacker rotating spoofed key material (XFF
// entries, device ids) could grow this Map unboundedly between sweeps, and on
// frozen serverless instances the interval pruner never fires at all. At the
// cap we force-sweep, then evict the stalest bucket if still full: under a key
// flood the limiter degrades (attackers evict each other) rather than the
// process leaking memory.
const MAX_BUCKETS = 20_000;

function sweepStale(now: number) {
  const cutoff = now - 5 * 60_000;
  for (const [key, bucket] of store) {
    if (bucket.lastRefill < cutoff) store.delete(key);
  }
}

function ensureCapacity(now: number) {
  if (store.size < MAX_BUCKETS) return;
  sweepStale(now);
  if (store.size >= MAX_BUCKETS) {
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [key, bucket] of store) {
      if (bucket.lastRefill < oldest) {
        oldest = bucket.lastRefill;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
}

// Prune stale buckets every 5 minutes to prevent unbounded memory growth.
if (typeof setInterval !== 'undefined') {
  setInterval(() => sweepStale(Date.now()), 5 * 60_000);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

/**
 * @param key       Unique identifier (IP, user id, etc.)
 * @param limit     Max requests per window
 * @param windowMs  Window duration in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (!store.has(key)) ensureCapacity(now);
  const bucket = store.get(key) ?? { tokens: limit, lastRefill: now };

  // Refill proportionally since last check
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor((elapsed / windowMs) * limit);
  if (refill > 0) {
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    store.set(key, bucket);
    return { allowed: false, remaining: 0, resetInMs: windowMs - elapsed };
  }

  bucket.tokens -= 1;
  store.set(key, bucket);
  return { allowed: true, remaining: bucket.tokens, resetInMs: windowMs - elapsed };
}

/** Visible for tests/observability — the Map is intentionally not exported. */
export function rateLimitBucketCount(): number {
  return store.size;
}

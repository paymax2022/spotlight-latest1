// Lightweight in-process rate limiter using a sliding-window token bucket.
// For production at scale replace with a Redis-backed limiter (e.g. Upstash).

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const store = new Map<string, Bucket>();

// AUD-PERF-002: the interval prune alone leaves an unbounded window — a
// caller rotating keys (spoofed IPs/ids) could grow the Map arbitrarily
// between sweeps. Hard cap: a NEW key past the cap triggers an inline sweep;
// if the map is still full the new key is denied (fail closed — a limiter
// that cannot track a key cannot safely permit it). Existing keys are never
// evicted, so legit traffic keeps its budget.
const MAX_TRACKED_KEYS = 10_000;

function pruneStale(now: number) {
  const cutoff = now - 5 * 60_000;
  for (const [key, bucket] of store) {
    if (bucket.lastRefill < cutoff) store.delete(key);
  }
}

// Prune stale buckets every 5 minutes to prevent unbounded memory growth.
if (typeof setInterval !== 'undefined') {
  setInterval(() => pruneStale(Date.now()), 5 * 60_000);
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
  let bucket = store.get(key);

  if (!bucket) {
    if (store.size >= MAX_TRACKED_KEYS) {
      pruneStale(now);
      if (store.size >= MAX_TRACKED_KEYS) {
        return { allowed: false, remaining: 0, resetInMs: windowMs };
      }
    }
    bucket = { tokens: limit, lastRefill: now };
  }

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

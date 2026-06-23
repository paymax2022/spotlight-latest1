// Lightweight in-process rate limiter using a sliding-window token bucket.
// For production at scale replace with a Redis-backed limiter (e.g. Upstash).

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const store = new Map<string, Bucket>();

// Prune stale buckets every 5 minutes to prevent unbounded memory growth.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [key, bucket] of store) {
      if (bucket.lastRefill < cutoff) store.delete(key);
    }
  }, 5 * 60_000);
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

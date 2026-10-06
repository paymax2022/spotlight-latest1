import type { NextResponse } from 'next/server';

// Go's auth limiter (NewAuthRateLimiter) stamps X-RateLimit-* on every request
// and Retry-After on a 429 — before the handler runs, so the headers exist on
// refusals too. The BFF routes rebuild the upstream response with
// NextResponse.json, which drops them, leaving a client that sees "429" with
// no way to learn the retry window. Copy the rate-limit headers through.
const RATE_LIMIT_HEADERS = [
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const;

export function forwardRateLimitHeaders(upstream: Response, res: NextResponse): void {
  for (const h of RATE_LIMIT_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.headers.set(h, v);
  }
}

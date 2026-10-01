import { describe, it, expect, afterEach, vi } from 'vitest';
import { getRequestIp } from '@/src/lib/rate-limit/client-ip';
import { checkRateLimit, rateLimitBucketCount } from '@/src/lib/voting/rate-limit';

function req(headers: Record<string, string>): Request {
  return new Request('https://app.test/x', { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getRequestIp — anti-spoofing', () => {
  it('takes the rightmost XFF entry, not the client-controlled leftmost', () => {
    // observed client IP at the end. Trust len-1, not 0.
    expect(getRequestIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('a single-entry XFF is the trusted hop itself', () => {
    expect(getRequestIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('respects RATE_LIMIT_TRUSTED_PROXY_HOPS for multi-proxy chains', () => {
    vi.stubEnv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '2');
    // Two trusted proxies appended the last two entries; the client IP is len-2.
    expect(getRequestIp(req({ 'x-forwarded-for': 'spoofed, 198.51.100.7, 10.0.0.1' }))).toBe('198.51.100.7');
  });

  it('groups requests whose chain is shorter than the trusted hop count', () => {
    vi.stubEnv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '2');
    expect(getRequestIp(req({ 'x-forwarded-for': 'attacker-chosen' }))).toBe('0.0.0.0');
  });

  it('rejects malformed entries and falls back to the shared bucket', () => {
    expect(getRequestIp(req({ 'x-forwarded-for': 'not an ip at all {}' }))).toBe('0.0.0.0');
  });

  it('falls back to x-real-ip when no XFF is present', () => {
    expect(getRequestIp(req({ 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('returns the shared bucket when nothing trustworthy is present', () => {
    expect(getRequestIp(req({}))).toBe('0.0.0.0');
  });
});

describe('checkRateLimit — bucket store is capped', () => {
  it('bounds the bucket map under a key flood', () => {
    // cap + the sweep eviction margin.
    for (let i = 0; i < 20_050; i++) {
      checkRateLimit(`flood:${i}`, 30, 60_000);
    }
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(20_000);
    // And the limiter still functions for a fresh key afterwards.
    expect(checkRateLimit('post-flood:key', 30, 60_000).allowed).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// AUD-SEC-001: proxyToGoBackend is the single funnel for ~147 /api/v1/* route
// handlers that previously carried no limiter at all. These specs pin the new
// per-client ceiling at the proxy layer.

function req(ip: string, path = 'https://app.test/api/v1/x'): Request {
  return new Request(path, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

async function proxy(mod: typeof import('@/src/lib/go-backend'), ip: string) {
  return mod.proxyToGoBackend(req(ip), '/api/finance/x');
}

beforeEach(() => {
  // Under the cap, calls must reach the upstream fetch.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('proxyToGoBackend rate limit', () => {
  it('passes requests through under the cap', async () => {
    vi.stubEnv('PROXY_RATE_LIMIT', '5');
    vi.resetModules();
    const mod = await import('@/src/lib/go-backend');

    const res = await proxy(mod, '203.0.113.1');
    expect(res.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('returns 429 + Retry-After once the cap is exceeded', async () => {
    vi.stubEnv('PROXY_RATE_LIMIT', '2');
    vi.resetModules();
    const mod = await import('@/src/lib/go-backend');

    expect((await proxy(mod, '203.0.113.2')).status).toBe(200);
    expect((await proxy(mod, '203.0.113.2')).status).toBe(200);
    const blocked = await proxy(mod, '203.0.113.2');

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('keys buckets per client IP — one client cannot starve another', async () => {
    vi.stubEnv('PROXY_RATE_LIMIT', '1');
    vi.resetModules();
    const mod = await import('@/src/lib/go-backend');

    expect((await proxy(mod, '203.0.113.3')).status).toBe(200);
    expect((await proxy(mod, '203.0.113.3')).status).toBe(429);
    expect((await proxy(mod, '198.51.100.7')).status).toBe(200);
  });

  it('honours a caller-supplied rateLimitKey over the IP', async () => {
    vi.stubEnv('PROXY_RATE_LIMIT', '1');
    vi.resetModules();
    const mod = await import('@/src/lib/go-backend');

    const r = () => new Request('https://app.test/api/v1/x', { method: 'GET' });
    const call = () => mod.proxyToGoBackend(r(), '/api/finance/x', { rateLimitKey: 'user:u1' });

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it('PROXY_RATE_LIMIT=0 disables the limiter', async () => {
    vi.stubEnv('PROXY_RATE_LIMIT', '0');
    vi.resetModules();
    const mod = await import('@/src/lib/go-backend');

    for (let i = 0; i < 5; i++) {
      expect((await proxy(mod, '203.0.113.4')).status).toBe(200);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
  });
});

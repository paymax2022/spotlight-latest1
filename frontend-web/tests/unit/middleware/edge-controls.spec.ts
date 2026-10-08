/**
 * Edge controls in the root middleware wrapper (frontend-web/middleware.ts).
 *
 * Two protections live there because the files that would otherwise hold them
 * are brownfield-protected (.claude/hooks/protect-legacy.sh):
 *
 *   1. POST throttles on the legacy paid-vote endpoints — the v1 twins of the
 *      limits PR #430 put on /api/v2/votes/paid/* (initiate 10/min/IP, verify
 *      30/min/IP), keyed with the SAME bucket prefixes so v1+v2 share one
 *      allowance instead of doubling it.
 *
 *   2. x-forwarded-for / x-real-ip normalization — ~45 route handlers read the
 *      LEFTMOST XFF entry verbatim for audit rows, fraud scoring
 *      (duplicate_ip), and the IP-scoped free-vote allowance. That entry is
 *      client-controlled. The wrapper rewrites both headers to the trust-aware
 *      getRequestIp() resolution before the request reaches any handler, and
 *      pins the same override on the response's x-middleware-request-* fields
 *      (the mechanism Next actually uses to forward mutated request headers).
 *
 * The inner session/CORS middleware (@/src/middleware) is mocked — these specs
 * pin the wrapper's own contract, not Supabase session handling.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
    }
    // Mirrors what real NextResponse.next({request}) emits: every request
    // header becomes an x-middleware-request-* override downstream. This is
    // the wire contract the wrapper relies on for the XFF rewrite.
    static next(init?: { request?: { headers: Headers } }) {
      const res = new Response(null, { status: 200 });
      if (init?.request?.headers) {
        const names: string[] = [];
        init.request.headers.forEach((value, key) => {
          names.push(key);
          res.headers.set(`x-middleware-request-${key}`, value);
        });
        res.headers.set('x-middleware-override-headers', names.join(','));
      }
      return res;
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: Request };
});

vi.mock('@/src/middleware', () => ({
  middleware: vi.fn(async (request: { headers: Headers }) => {
    const { NextResponse } = await import('next/server');
    return (NextResponse as unknown as { next(i?: unknown): Response }).next({ request });
  }),
}));

import { middleware } from '../../../middleware';

function req(
  path: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): unknown {
  return {
    method: opts.method ?? 'POST',
    headers: new Headers(opts.headers ?? {}),
    nextUrl: { pathname: path },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('legacy paid-vote throttles (AUD-SEC-001 residual)', () => {
  it('POST /api/votes/paid/initiate 429s after 10/min per client IP', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 10; i++) {
      const res = await middleware(req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': ip } }) as never);
      expect(res.status).toBe(200);
    }
    const blocked = await middleware(req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': ip } }) as never);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('POST /api/votes/paid/verify 429s after 30/min per client IP', async () => {
    const ip = '203.0.113.51';
    for (let i = 0; i < 30; i++) {
      const res = await middleware(req('/api/votes/paid/verify', { headers: { 'x-forwarded-for': ip } }) as never);
      expect(res.status).toBe(200);
    }
    const blocked = await middleware(req('/api/votes/paid/verify', { headers: { 'x-forwarded-for': ip } }) as never);
    expect(blocked.status).toBe(429);
  });

  it('a second client IP keeps its own allowance', async () => {
    const ipA = '203.0.113.52';
    for (let i = 0; i < 10; i++) {
      await middleware(req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': ipA } }) as never);
    }
    expect(
      (await middleware(req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': ipA } }) as never)).status,
    ).toBe(429);
    expect(
      (await middleware(req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': '203.0.113.53' } }) as never)).status,
    ).toBe(200);
  });

  it('non-POST requests to the same paths are not throttled', async () => {
    const ip = '203.0.113.54';
    for (let i = 0; i < 15; i++) {
      const res = await middleware(
        req('/api/votes/paid/initiate', { method: 'GET', headers: { 'x-forwarded-for': ip } }) as never,
      );
      expect(res.status).toBe(200);
    }
  });

  it('shares the v2 bucket: forged XFF rotation cannot refresh the allowance', async () => {
    // Attacker fires v1 requests while rotating the client-claimed leftmost
    // XFF hop — every request lands in ONE bucket keyed on the edge-appended IP.
    const edgeSeen = '203.0.113.60';
    for (let i = 0; i < 10; i++) {
      const res = await middleware(
        req('/api/votes/paid/initiate', {
          headers: { 'x-forwarded-for': `10.${i}.0.1, ${edgeSeen}` },
        }) as never,
      );
      expect(res.status).toBe(200);
    }
    const blocked = await middleware(
      req('/api/votes/paid/initiate', { headers: { 'x-forwarded-for': `10.99.0.1, ${edgeSeen}` } }) as never,
    );
    expect(blocked.status).toBe(429);
  });
});

describe('client-IP normalization (AUD-SEC-004)', () => {
  it('rewrites XFF to the edge-appended (real) client IP, dropping client-claimed hops', async () => {
    const res = await middleware(
      req('/api/anything', {
        method: 'GET',
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      }) as never,
    );
    expect(res.headers.get('x-middleware-request-x-forwarded-for')).toBe('5.6.7.8');
    expect(res.headers.get('x-middleware-request-x-real-ip')).toBe('5.6.7.8');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-forwarded-for');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-real-ip');
  });

  it('mutates the forwarded request headers before the inner middleware sees them', async () => {
    const { middleware: inner } = await import('@/src/middleware');
    const request = req('/api/anything', {
      method: 'GET',
      headers: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' },
    }) as { headers: Headers };
    await middleware(request as never);
    expect(vi.mocked(inner)).toHaveBeenCalled();
    expect(request.headers.get('x-forwarded-for')).toBe('5.6.7.8');
    expect(request.headers.get('x-real-ip')).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip when XFF is absent', async () => {
    const res = await middleware(
      req('/api/anything', { method: 'GET', headers: { 'x-real-ip': '198.51.100.7' } }) as never,
    );
    expect(res.headers.get('x-middleware-request-x-forwarded-for')).toBe('198.51.100.7');
    expect(res.headers.get('x-middleware-request-x-real-ip')).toBe('198.51.100.7');
  });

  it('collapses an XFF chain shorter than the trusted hop count into the shared bucket IP', async () => {
    vi.stubEnv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '2');
    const res = await middleware(
      req('/api/anything', { method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }) as never,
    );
    expect(res.headers.get('x-middleware-request-x-forwarded-for')).toBe('0.0.0.0');
  });

  it('does not touch page routes', async () => {
    const res = await middleware(req('/profile', { method: 'GET' }) as never);
    expect(res.headers.get('x-middleware-request-x-forwarded-for')).toBeNull();
  });
});

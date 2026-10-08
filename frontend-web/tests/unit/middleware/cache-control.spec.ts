/**
 * Cache policy on the BFF (src/middleware.ts → handleApiCors).
 *
 * Prod-sweep finding: most /api/* route handlers emit NO Cache-Control, so a
 * shared cache is free to store personalized payloads keyed only on the URL.
 * The middleware now pins `Cache-Control: no-store` on every response to a
 * CREDENTIALED api request — one that carries any of the auth carriers this
 * app accepts:
 *
 *   - Authorization: Bearer <supabase JWT>   (src/lib/auth/request.ts)
 *   - x-admin-key                             (src/server/admin/auth.ts)
 *   - a Supabase session cookie — sb-<ref>-auth-token, incl. chunked `.0/.1`
 *
 * Anonymous requests are deliberately untouched: public GETs (contests list,
 * banners) legitimately benefit from CDN caching, and stamping no-store on
 * them would be a needless regression.
 *
 * The Supabase auth path is not exercised — /api/* short-circuits into
 * handleApiCors before any session work.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
    }
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

import { middleware } from '../../../src/middleware';

function req(
  path: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): unknown {
  return {
    method: opts.method ?? 'GET',
    headers: new Headers(opts.headers ?? {}),
    nextUrl: { pathname: path, search: '' },
    cookies: { getAll: () => [] },
  };
}

describe('api cache policy — credentialed requests get no-store', () => {
  it('stamps no-store when the request carries a Bearer token', async () => {
    const res = await middleware(
      req('/api/v1/food/cart', { headers: { authorization: 'Bearer abc.def.ghi' } }) as never,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stamps no-store when the request carries the admin API key', async () => {
    const res = await middleware(
      req('/api/admin/voting/c1/revenue', { headers: { 'x-admin-key': 'k' } }) as never,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stamps no-store when the request carries a Supabase session cookie (incl. chunks)', async () => {
    const res = await middleware(
      req('/api/me', {
        headers: { cookie: 'theme=dark; sb-127-auth-token.0=AAA; sb-127-auth-token.1=BBB' },
      }) as never,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stamps no-store on credentialed non-GET methods too', async () => {
    const res = await middleware(
      req('/api/v1/transfers', {
        method: 'POST',
        headers: { authorization: 'Bearer abc.def.ghi' },
      }) as never,
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('api cache policy — anonymous requests are left cacheable', () => {
  it('emits no Cache-Control on a public GET with no credentials', async () => {
    const res = await middleware(req('/api/contests') as never);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('a benign cookie does not count as a credential', async () => {
    const res = await middleware(
      req('/api/contests', { headers: { cookie: 'theme=dark; locale=en' } }) as never,
    );
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('OPTIONS preflight is unchanged (204, no cache stamp)', async () => {
    const res = await middleware(req('/api/v1/food/cart', { method: 'OPTIONS' }) as never);
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

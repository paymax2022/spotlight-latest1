/**
 * AUTH-010: the admin-proxy route is the admin console's REAL data path and,
 * unlike every page under /admin/*, is not covered by middleware.ts (whose
 * matcher is '/admin/:path*' — this route lives at '/api/admin-proxy/*'). It
 * used to forward every request, verified or not, while still unconditionally
 * attaching x-admin-api-key when configured — a confused deputy handing its
 * own secret to anonymous callers. These tests pin the fix: no verified
 * session cookie, no forward.
 *
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractSessionToken } from './route';

function base64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: Record<string, unknown>, secret: string | undefined): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = secret
    ? base64Url(createHmac('sha256', secret).update(signingInput).digest())
    : base64Url('not-a-real-signature');
  return `${signingInput}.${sig}`;
}

const REAL_SECRET = 'test-only-hs256-secret-does-not-need-to-be-long';
const notExpired = { sub: 'admin-1', exp: Math.floor(Date.now() / 1000) + 3600 };

describe('extractSessionToken', () => {
  it('returns undefined for no cookie header', () => {
    expect(extractSessionToken(null)).toBeUndefined();
  });

  it('returns undefined when the admin session cookie is absent', () => {
    expect(extractSessionToken('other=1; another=2')).toBeUndefined();
  });

  it('extracts the sb-admin-token value among other cookies', () => {
    expect(extractSessionToken('a=1; sb-admin-token=the-token; b=2')).toBe('the-token');
  });

  it('URL-decodes the value', () => {
    expect(extractSessionToken('sb-admin-token=a%2Eb%2Ec')).toBe('a.b.c');
  });
});

describe('admin-proxy forward() — AUTH-010 session gate', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_JWT_SECRET', REAL_SECRET);
    vi.stubEnv('ADMIN_API_KEY', 'the-real-admin-key');
    vi.stubEnv('ADMIN_API_BASE_URL', 'http://backend.invalid');
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: 'sensitive' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  async function callForward(cookie?: string) {
    const { GET } = await import('./route');
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    const req = new Request('http://admin.invalid/api/admin-proxy/api/v1/admin/leads', {
      method: 'GET',
      headers,
    });
    return GET(req, { params: Promise.resolve({ path: ['api', 'v1', 'admin', 'leads'] }) });
  }

  it('rejects an anonymous request (no cookie at all) before forwarding', async () => {
    const res = await callForward(undefined);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a request with an unsigned/forged token', async () => {
    const forged = makeToken(notExpired, undefined);
    const res = await callForward(`sb-admin-token=${forged}`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a request with an expired, correctly-signed token', async () => {
    const expired = makeToken({ sub: 'admin-1', exp: Math.floor(Date.now() / 1000) - 3600 }, REAL_SECRET);
    const res = await callForward(`sb-admin-token=${expired}`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('forwards a request bearing a valid, correctly-signed, unexpired session cookie', async () => {
    const token = makeToken(notExpired, REAL_SECRET);
    const res = await callForward(`sb-admin-token=${token}`);
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('http://backend.invalid/');
    expect((init.headers as Record<string, string>)['x-admin-api-key']).toBe('the-real-admin-key');
  });

  it('fails closed with no SUPABASE_JWT_SECRET configured, even for a structurally valid token', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    const forged = makeToken(notExpired, undefined);
    const res = await callForward(`sb-admin-token=${forged}`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // AUTH-020: x-stem-role was missing from the outbound-header allowlist, so
  // the backend's RequireStemRoles middleware always saw "missing stem role"
  // (403) regardless of what the STEM admin console UI sent — this pins the
  // fix forwarding it, the same way Idempotency-Key and Authorization are
  // already forwarded above.
  it('forwards the x-stem-role header to the backend', async () => {
    const token = makeToken(notExpired, REAL_SECRET);
    const { GET } = await import('./route');
    const headers = new Headers();
    headers.set('cookie', `sb-admin-token=${token}`);
    headers.set('x-stem-role', 'CONTEST_MANAGER');
    const req = new Request('http://admin.invalid/api/admin-proxy/api/v1/admin/stem/overview', {
      method: 'GET',
      headers,
    });
    const res = await GET(req, { params: Promise.resolve({ path: ['api', 'v1', 'admin', 'stem', 'overview'] }) });
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)['x-stem-role']).toBe('CONTEST_MANAGER');
  });

  it('omits x-stem-role when the caller did not send one', async () => {
    const token = makeToken(notExpired, REAL_SECRET);
    const res = await callForward(`sb-admin-token=${token}`);
    expect(res.status).toBe(200);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)['x-stem-role']).toBeUndefined();
  });
});

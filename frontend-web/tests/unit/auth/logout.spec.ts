/**
 * E2E-SEC-055 regression suite — POST /api/auth/logout.
 *
 * Previously: accepted anonymous POSTs and returned 200 either way; and when a
 * Bearer token WAS supplied it called admin.auth.admin.signOut(user.id) — but
 * signOut's first arg is the caller's JWT, not a user id — so GoTrue revoked
 * nothing. Tokens survived "logout".
 *
 * Now pinned: anon/invalid → 401; a valid session → GoTrue signOut(jwt,
 * 'global') revokes every session server-side, sb-*-auth-token cookies are
 * expired on the response, and an audit event is emitted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => {
      const res = new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
      // Minimal cookies.set shim — appends a real Set-Cookie header so the
      // spec can assert expiry via headers.
      (res as unknown as { cookies: { set: (n: string, v: string, o?: { path?: string; maxAge?: number }) => void } }).cookies = {
        set(name, value, opts) {
          res.headers.append(
            'Set-Cookie',
            `${name}=${value}; Path=${opts?.path ?? '/'}; Max-Age=${opts?.maxAge ?? 0}`,
          );
        },
      };
      return res;
    },
  },
}));

const serviceClient = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    admin: { signOut: vi.fn() },
  },
  from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })),
}));

vi.mock('../../../app/api/auth/_supabase', () => ({
  createServiceClient: () => serviceClient,
  extractBearerToken: (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  },
}));

// Cookie-session fallback client (only consulted when no Bearer header).
const cookieClient = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'no session' } })),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => cookieClient),
  createAdminClient: () => serviceClient,
}));

vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));

import { POST } from '../../../app/api/auth/logout/route';
import { addAuditEvent } from '@/src/server/admin/audit';

const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'ada@example.test' };

function req(init: { bearer?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.cookie) headers.cookie = init.cookie;
  return new Request('http://localhost/api/auth/logout', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient.auth.getUser.mockImplementation(async (token: string) =>
    token === 'good-token'
      ? { data: { user: USER }, error: null }
      : { data: { user: null }, error: { message: 'invalid token' } });
  serviceClient.auth.admin.signOut.mockResolvedValue({ data: null, error: null });
});

describe('POST /api/auth/logout', () => {
  it('401s an anonymous request and revokes nothing', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(serviceClient.auth.admin.signOut).not.toHaveBeenCalled();
    expect(addAuditEvent).not.toHaveBeenCalled();
  });

  it('401s an invalid Bearer token', async () => {
    const res = await POST(req({ bearer: 'bad-token' }));
    expect(res.status).toBe(401);
    expect(serviceClient.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it('revokes the session globally via GoTrue with the caller JWT (not the user id)', async () => {
    const res = await POST(req({ bearer: 'good-token' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Logged out successfully');
    expect(serviceClient.auth.admin.signOut).toHaveBeenCalledWith('good-token', 'global');
  });

  it('emits an audit event for the logout', async () => {
    await POST(req({ bearer: 'good-token' }));
    expect(addAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth_logout',
        module: 'auth',
        entityType: 'auth_session',
        entityId: USER.id,
      }),
    );
  });

  it('expires sb-*-auth-token cookies (incl. chunks) on the response', async () => {
    const res = await POST(
      req({ bearer: 'good-token', cookie: 'sb-127-auth-token.0=AAA; sb-127-auth-token.1=BBB; other=keep' }),
    );
    const setCookies = res.headers.getSetCookie();
    const expired = setCookies.filter((c) => c.includes('Max-Age=0'));
    expect(expired.some((c) => c.startsWith('sb-127-auth-token.0='))).toBe(true);
    expect(expired.some((c) => c.startsWith('sb-127-auth-token.1='))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('other='))).toBe(false);
  });

  it('502s honestly when GoTrue revocation fails', async () => {
    serviceClient.auth.admin.signOut.mockResolvedValue({
      data: null,
      error: { message: 'gotrue down' },
    });
    const res = await POST(req({ bearer: 'good-token' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

/**
 * syncAdminSession must notice a session GoTrue has revoked.
 *
 * supabase-js getSession() only checks the token's own expiry, so after a
 * server-side revocation (password reset via the admin API, sign-out elsewhere)
 * the console kept re-mirroring a dead token into the cookie and looked signed
 * in while every proxied call came back 401 "invalid token" — which the
 * dashboard then reported as the backend not answering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';

const auth = {
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
};
vi.mock('@/services/supabaseClient', () => ({ getSupabaseClient: () => ({ auth }) }));

const session = { access_token: 'a.b.c', expires_at: Math.floor(Date.now() / 1000) + 1800 };

describe('syncAdminSession', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchFn);
    localStorage.setItem('spotlight_admin_user', '{"id":"u1"}');
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  const cookieCalls = () => fetchFn.mock.calls.map(([, init]) => (init as RequestInit).method);

  it('keeps a session GoTrue still recognises and mirrors it into the cookie', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const { syncAdminSession } = await import('./adminAuth');

    expect(await syncAdminSession()).toBe(true);
    expect(auth.getUser).toHaveBeenCalledWith('a.b.c');
    expect(cookieCalls()).toEqual(['POST']);
    expect(localStorage.getItem('spotlight_admin_user')).not.toBeNull();
  });

  it('drops a session GoTrue no longer knows, even though the token has not expired', async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'Session from session_id claim in JWT does not exist', status: 403, code: 'session_not_found' },
    });
    const { syncAdminSession } = await import('./adminAuth');

    expect(await syncAdminSession()).toBe(false);
    expect(cookieCalls()).toEqual(['DELETE']);
    expect(localStorage.getItem('spotlight_admin_user')).toBeNull();
    // The persisted refresh token is dead too; forget it locally so the next
    // guard pass does not resurrect the same rejected session.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("drops the session when supabase-js reports GoTrue's session_not_found as AuthSessionMissingError", async () => {
    // This is what actually comes back for a revoked session: supabase-js
    // rewrites GoTrue's 403 session_not_found into its own 400-status error.
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const { syncAdminSession } = await import('./adminAuth');

    expect(await syncAdminSession()).toBe(false);
    expect(cookieCalls()).toEqual(['DELETE']);
    expect(localStorage.getItem('spotlight_admin_user')).toBeNull();
  });

  it('treats a 401 from GoTrue the same way', async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'invalid JWT', status: 401, code: 'bad_jwt' },
    });
    const { syncAdminSession } = await import('./adminAuth');
    expect(await syncAdminSession()).toBe(false);
    expect(cookieCalls()).toEqual(['DELETE']);
  });

  it('does not sign the operator out when GoTrue itself is unreachable', async () => {
    // A transport failure is an outage, not a verdict on the session.
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 },
    });
    const { syncAdminSession } = await import('./adminAuth');

    expect(await syncAdminSession()).toBe(true);
    expect(cookieCalls()).toEqual(['POST']);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

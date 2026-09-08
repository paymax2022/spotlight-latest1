import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The OTP routes are Go-first with a Supabase fallback. The fallback exists
 * because FEATURE_OTP_EMAIL_ENABLED is off by default and cannot be turned on
 * until a Brevo account exists — so shipping this must not break sign-up in an
 * environment where the flag is off.
 *
 * What these pin is the NARROWNESS of that fallback. Falling back on a real
 * rejection would re-ask Supabase about a code it never issued, turning "that
 * code is wrong" into a second, confusing error — and, on the reset path, would
 * be an outright security hole: a wrong code must not reach a second chance.
 */
const ORIGINAL_FETCH = globalThis.fetch;

const supabaseCalls: string[] = [];
const supabaseResult: { verifyOtp: any; resend: any } = {
  verifyOtp: { data: { session: null, user: null }, error: { message: 'supabase says no', status: 400 } },
  resend: { error: null },
};

vi.mock('@/app/api/auth/_supabase', () => ({
  createAnonClient: () => ({
    auth: {
      verifyOtp: async () => { supabaseCalls.push('verifyOtp'); return supabaseResult.verifyOtp; },
      resend: async () => { supabaseCalls.push('resend'); return supabaseResult.resend; },
      resetPasswordForEmail: async () => { supabaseCalls.push('resetPasswordForEmail'); return { error: null }; },
    },
  }),
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: { admin: { updateUserById: async () => ({ error: null }) }, getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  }),
  formatUser: (u: unknown) => u,
  extractBearerToken: () => null,
}));

function mockGo(status: number, payload: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function mockGoUnreachable() {
  const spy = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

async function post(mod: string, body: unknown, init: RequestInit = {}) {
  const { POST } = await import(mod);
  return POST(new Request('http://localhost/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...init,
  }));
}

beforeEach(() => { vi.resetModules(); supabaseCalls.length = 0; });
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

describe('POST /api/auth/verify-otp', () => {
  it('uses Go when the feature is on, and reports that no session was created', async () => {
    const spy = mockGo(200, { success: true, verified: true, purpose: 'verify_email' });

    const res = await post('@/app/api/auth/verify-otp/route', { email: 'Ada@Example.test', otp: '482913' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verified).toBe(true);
    // The caller MUST see this: Go confirms the account without signing anyone
    // in, so a client that navigates to a logged-in screen would arrive with no
    // session.
    expect(body.signedIn).toBe(false);
    expect(supabaseCalls).toEqual([]);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/otp/verify');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ email: 'ada@example.test', code: '482913', purpose: 'verify_email' });
  });

  it('falls back to Supabase when Go says the feature is disabled', async () => {
    mockGo(503, { success: false, error: 'feature_disabled', feature: 'otp_email' });
    supabaseResult.verifyOtp = {
      data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } }, error: null,
    };

    const res = await post('@/app/api/auth/verify-otp/route', { email: 'a@b.test', otp: '111111' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(supabaseCalls).toEqual(['verifyOtp']);
    // Supabase's signup OTP DOES sign the user in, and the flag says so.
    expect(body.signedIn).toBe(true);
  });

  it('falls back when Go is unreachable, so an outage in the new service does not take sign-up down', async () => {
    mockGoUnreachable();
    supabaseResult.verifyOtp = {
      data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } }, error: null,
    };

    const res = await post('@/app/api/auth/verify-otp/route', { email: 'a@b.test', otp: '111111' });
    expect(res.status).toBe(200);
    expect(supabaseCalls).toEqual(['verifyOtp']);
  });

  it('does NOT fall back on a wrong code — that answer is final', async () => {
    mockGo(400, { success: false, error: 'invalid code' });

    const res = await post('@/app/api/auth/verify-otp/route', { email: 'a@b.test', otp: '000000' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid code');
    expect(supabaseCalls).toEqual([]);
  });

  it('does NOT fall back on a lockout', async () => {
    mockGo(429, { success: false, error: 'too many attempts, request a new code' });

    const res = await post('@/app/api/auth/verify-otp/route', { email: 'a@b.test', otp: '000000' });
    expect(res.status).toBe(429);
    expect(supabaseCalls).toEqual([]);
  });
});

describe('POST /api/auth/resend-otp', () => {
  it('asks Go for a verify_email code', async () => {
    const spy = mockGo(200, { success: true });
    const res = await post('@/app/api/auth/resend-otp/route', { email: 'a@b.test' });

    expect(res.status).toBe(200);
    expect(supabaseCalls).toEqual([]);
    const sent = JSON.parse(String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toMatchObject({ email: 'a@b.test', purpose: 'verify_email' });
  });

  it('passes a throttle through instead of quietly resending via Supabase', async () => {
    mockGo(429, { success: false, error: 'please wait before requesting another code' });
    const res = await post('@/app/api/auth/resend-otp/route', { email: 'a@b.test' });

    expect(res.status).toBe(429);
    // Falling back here would send a SECOND email and report success, defeating
    // the cooldown the user was just told about.
    expect(supabaseCalls).toEqual([]);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sends the code form to Go', async () => {
    const spy = mockGo(200, { success: true, message: 'Password reset successful' });
    const res = await post('@/app/api/auth/reset-password/route',
      { email: 'A@b.test', code: '482913', password: 'brand-new-passphrase' });

    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/reset-password');
    expect(JSON.parse(String(init.body))).toMatchObject({
      email: 'a@b.test', code: '482913', newPassword: 'brand-new-passphrase',
    });
  });

  it('refuses rather than falling back when the code path is closed', async () => {
    mockGo(503, { success: false, error: 'feature_disabled' });
    const res = await post('@/app/api/auth/reset-password/route',
      { email: 'a@b.test', code: '482913', password: 'brand-new-passphrase' });
    const body = await res.json();

    expect(res.status).toBe(503);
    // There is no Supabase equivalent for a code Supabase never issued; the user
    // is pointed at the link, which is the mechanism that works in that state.
    expect(String(body.error)).toContain('link');
  });

  it('a wrong code is final — it must not get a second chance elsewhere', async () => {
    mockGo(400, { success: false, error: 'invalid code' });
    const res = await post('@/app/api/auth/reset-password/route',
      { email: 'a@b.test', code: '000000', password: 'brand-new-passphrase' });

    expect(res.status).toBe(400);
    expect(supabaseCalls).toEqual([]);
  });

  it('still rejects a request carrying neither a code nor a link session', async () => {
    mockGo(200, {});
    const res = await post('@/app/api/auth/reset-password/route', { password: 'brand-new-passphrase' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('prefers Go, which sends BOTH the link and the code', async () => {
    const spy = mockGo(200, { success: true });
    const res = await post('@/app/api/auth/forgot-password/route', { email: 'a@b.test' });

    expect(res.status).toBe(200);
    expect(String((spy.mock.calls[0] as unknown as [string, RequestInit])[0])).toContain('/api/auth/request-password-reset');
    // Calling Supabase as well would send a second link.
    expect(supabaseCalls).toEqual([]);
  });

  it('falls back to the link alone when Go is unreachable', async () => {
    mockGoUnreachable();
    const res = await post('@/app/api/auth/forgot-password/route', { email: 'a@b.test' });

    expect(res.status).toBe(200);
    expect(supabaseCalls).toEqual(['resetPasswordForEmail']);
  });

  it('answers identically whether or not the upstream succeeded', async () => {
    mockGo(200, { success: true });
    const ok = await post('@/app/api/auth/forgot-password/route', { email: 'a@b.test' });
    const okBody = await ok.json();

    vi.resetModules(); supabaseCalls.length = 0;
    mockGo(500, { error: 'boom' });
    const bad = await post('@/app/api/auth/forgot-password/route', { email: 'a@b.test' });
    const badBody = await bad.json();

    // Any difference here is an account-enumeration oracle.
    expect(bad.status).toBe(ok.status);
    expect(badBody).toEqual(okBody);
  });
});

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

  it('answers identically whether the resend was sent or throttled — a 429 vs 200 was an enumeration oracle', async () => {
    mockGo(200, { success: true });
    const ok = await post('@/app/api/auth/resend-otp/route', { email: 'a@b.test' });
    const okBody = await ok.json();

    vi.resetModules(); supabaseCalls.length = 0;
    mockGo(429, { success: false, error: 'please wait before requesting another code' });
    const throttled = await post('@/app/api/auth/resend-otp/route', { email: 'a@b.test' });
    const throttledBody = await throttled.json();

    // An existing unverified account hits the per-address cooldown (429) while
    // an unknown address answered 200 — differing status+body confirmed account
    // existence to unauthenticated callers. The throttle is still enforced
    // upstream (no second email goes out); only the response is uniform.
    expect(throttled.status).toBe(ok.status);
    expect(throttledBody).toEqual(okBody);
    // And it must not quietly resend via Supabase — that would send a SECOND
    // email and defeat the cooldown the upstream just enforced.
    expect(supabaseCalls).toEqual([]);
  });
});

// Password reset is the emailed CODE only — no link, and therefore no Supabase
// fallback. Three steps: request → verify (returns a resetToken) → set password.

describe('POST /api/auth/forgot-password', () => {
  it('asks Go for a code, with the identifier as typed (email OR phone)', async () => {
    const spy = mockGo(200, { success: true });
    const res = await post('@/app/api/auth/forgot-password/route', { identifier: ' 0803 123 4567 ' });

    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/auth/request-password-reset');
    expect(JSON.parse(String(init.body))).toEqual({ identifier: '0803 123 4567' });
  });

  it('still accepts the older "email" key', async () => {
    const spy = mockGo(200, { success: true });
    await post('@/app/api/auth/forgot-password/route', { email: 'a@b.test' });
    expect(JSON.parse(String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ identifier: 'a@b.test' });
  });

  it('NEVER sends a Supabase reset link — not even when Go is closed or unreachable', async () => {
    mockGo(503, { success: false, error: 'feature_disabled' });
    const closed = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    expect(closed.status).toBe(503);

    vi.resetModules();
    mockGoUnreachable();
    const down = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    expect(down.status).toBe(503);

    // The old behaviour fell back to resetPasswordForEmail, i.e. a link.
    expect(supabaseCalls).toEqual([]);
  });

  it('does not claim a code was sent when none can be', async () => {
    mockGo(503, { success: false, error: 'feature_disabled' });
    const res = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    const body = await res.json();
    expect(String(body.error).toLowerCase()).toContain('unavailable');
    expect(body.message).toBeUndefined();
  });

  it('answers identically whether or not the upstream succeeded', async () => {
    mockGo(200, { success: true });
    const ok = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    const okBody = await ok.json();

    vi.resetModules();
    mockGo(500, { error: 'boom' });
    const bad = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    const badBody = await bad.json();

    // Any difference here is an account-enumeration oracle.
    expect(bad.status).toBe(ok.status);
    expect(badBody).toEqual(okBody);
  });

  it('tells a throttled caller to wait — that limit is per IP, not per account', async () => {
    mockGo(429, { success: false, error: 'Too many attempts. Please try again later.' });
    const res = await post('@/app/api/auth/forgot-password/route', { identifier: 'a@b.test' });
    expect(res.status).toBe(429);
  });
});

describe('POST /api/auth/verify-password-reset-otp', () => {
  it('returns the resetToken only when Go accepts the code', async () => {
    const spy = mockGo(200, { success: true, verified: true, resetToken: 'tok-abc' });
    const res = await post('@/app/api/auth/verify-password-reset-otp/route',
      { identifier: '08031234567', code: ' 482913 ' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, resetToken: 'tok-abc' });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/auth/verify-password-reset-otp');
    expect(JSON.parse(String(init.body))).toEqual({ identifier: '08031234567', code: '482913' });
  });

  it('a wrong code is final — no second chance elsewhere, and no token', async () => {
    mockGo(400, { success: false, error: 'invalid code' });
    const res = await post('@/app/api/auth/verify-password-reset-otp/route',
      { identifier: 'a@b.test', code: '000000' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid code');
    expect(body.resetToken).toBeUndefined();
    expect(supabaseCalls).toEqual([]);
  });

  it('passes through expiry and lockout wording and status', async () => {
    mockGo(400, { success: false, error: 'code expired, request a new code' });
    const expired = await post('@/app/api/auth/verify-password-reset-otp/route', { identifier: 'a@b.test', code: '1' });
    expect(expired.status).toBe(400);
    expect((await expired.json()).error).toContain('expired');

    vi.resetModules();
    mockGo(429, { success: false, error: 'too many attempts, request a new code' });
    const locked = await post('@/app/api/auth/verify-password-reset-otp/route', { identifier: 'a@b.test', code: '1' });
    expect(locked.status).toBe(429);
  });

  it('never reports success when Go sent nothing to continue with', async () => {
    mockGo(200, { success: true, verified: true });
    const res = await post('@/app/api/auth/verify-password-reset-otp/route', { identifier: 'a@b.test', code: '482913' });
    expect(res.status).toBe(502);
    expect((await res.json()).verified).toBeUndefined();
  });

  it('is 503 when codes are unavailable', async () => {
    mockGo(503, { success: false, error: 'feature_disabled' });
    const res = await post('@/app/api/auth/verify-password-reset-otp/route', { identifier: 'a@b.test', code: '482913' });
    expect(res.status).toBe(503);
  });

  it('rejects a request missing the identifier or the code', async () => {
    mockGo(200, {});
    expect((await post('@/app/api/auth/verify-password-reset-otp/route', { identifier: 'a@b.test' })).status).toBe(400);
    expect((await post('@/app/api/auth/verify-password-reset-otp/route', { code: '482913' })).status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sends identifier + resetToken + new password to Go', async () => {
    const spy = mockGo(200, { success: true, message: 'Password reset successful' });
    const res = await post('@/app/api/auth/reset-password/route',
      { identifier: '08031234567', resetToken: 'tok-abc', password: 'brand-new-passphrase' });

    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/auth/reset-password');
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: '08031234567', resetToken: 'tok-abc', newPassword: 'brand-new-passphrase',
    });
  });

  it('refuses a request that skipped the code step', async () => {
    const spy = mockGo(200, {});
    const res = await post('@/app/api/auth/reset-password/route',
      { identifier: 'a@b.test', password: 'brand-new-passphrase' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a raw emailed code is not accepted in place of the token', async () => {
    const spy = mockGo(200, {});
    const res = await post('@/app/api/auth/reset-password/route',
      { email: 'a@b.test', code: '482913', password: 'brand-new-passphrase' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('checks the length BEFORE asking Go to spend the token', async () => {
    const spy = mockGo(200, {});
    const res = await post('@/app/api/auth/reset-password/route',
      { identifier: 'a@b.test', resetToken: 'tok-abc', password: 'short' });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('there is no link-session form any more', async () => {
    mockGo(200, {});
    const res = await post('@/app/api/auth/reset-password/route', { password: 'brand-new-passphrase' },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer some-recovery-token' } });
    expect(res.status).toBe(400);
  });

  it('a bad or spent token is final', async () => {
    mockGo(400, { success: false, error: 'invalid code' });
    const res = await post('@/app/api/auth/reset-password/route',
      { identifier: 'a@b.test', resetToken: 'stale', password: 'brand-new-passphrase' });
    expect(res.status).toBe(400);
    expect(supabaseCalls).toEqual([]);
  });

  it('is 503 when codes are unavailable, without pointing at a link', async () => {
    mockGo(503, { success: false, error: 'feature_disabled' });
    const res = await post('@/app/api/auth/reset-password/route',
      { identifier: 'a@b.test', resetToken: 'tok-abc', password: 'brand-new-passphrase' });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(String(body.error).toLowerCase()).not.toContain('link');
  });
});

describe('malformed request bodies', () => {
  // A bare `await request.json()` let a SyntaxError reach the catch-all, which
  // answered 500 with the parser's message ("Unexpected token 'o'...").
  // The routes now mirror login/register: parse failure → null → the field
  // checks answer a clean 400.
  const routes: Array<[string, string, string]> = [
    ['verify-otp', '@/app/api/auth/verify-otp/route', 'Email and OTP are required'],
    ['otp-verify', '@/app/api/auth/otp-verify/route', 'Email and code are required'],
    ['resend-otp', '@/app/api/auth/resend-otp/route', 'Email is required'],
    ['forgot-password', '@/app/api/auth/forgot-password/route', 'Email or phone number is required'],
    ['verify-password-reset-otp', '@/app/api/auth/verify-password-reset-otp/route', 'Identifier and code are required'],
    ['reset-password', '@/app/api/auth/reset-password/route', 'Password must be at least 8 characters'],
  ];

  for (const [name, mod, expected] of routes) {
    it(`${name} answers 400, not a parser 500`, async () => {
      const { POST } = await import(mod);
      const res = await POST(new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'oops{',
      }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(expected);
    });
  }
});

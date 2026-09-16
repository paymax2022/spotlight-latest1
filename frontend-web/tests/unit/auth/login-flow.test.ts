import { describe, it, expect, vi } from 'vitest';
import {
  AuthRequestError,
  requestLoginOtpVerify,
  requestSignIn,
  requestSignUp,
} from '@/src/features/auth/loginFlow';

// AUTH-016: app/login/page.tsx used to call supabase.auth.signInWithPassword /
// supabase.auth.signUp DIRECTLY from the browser, which skipped the Go backend
// entirely (no lockout, no rate limiting, no OTP-login step-up, no audit event).
// These pin that signIn/signUp now go through the Next.js proxy routes
// (/api/auth/login, /api/auth/register, /api/auth/otp-verify), not Supabase.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => jsonResponse(status, body));
}

describe('requestSignIn', () => {
  it('calls /api/auth/login, not Supabase, with identifier+password', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      session: { access_token: 'at', refresh_token: 'rt' },
      tokens: { accessToken: 'at', refreshToken: 'rt' },
    });

    const outcome = await requestSignIn(fetchImpl, 'ada@example.test', 'Str0ngPass!23');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login');
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({ identifier: 'ada@example.test', password: 'Str0ngPass!23' });

    expect(outcome).toEqual({ kind: 'session', tokens: { accessToken: 'at', refreshToken: 'rt' } });
  });

  it('surfaces mfaRequired instead of treating it as a missing session', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      mfaRequired: true,
      message: 'Enter the code we emailed you to finish signing in.',
    });

    const outcome = await requestSignIn(fetchImpl, 'ada@example.test', 'Str0ngPass!23');
    expect(outcome).toEqual({
      kind: 'mfaRequired',
      email: 'ada@example.test',
      message: 'Enter the code we emailed you to finish signing in.',
    });
  });

  it('maps a 403 email_not_confirmed response to the verify-email outcome', async () => {
    const fetchImpl = fakeFetch(403, { error: 'not verified', code: 'email_not_confirmed' });
    const outcome = await requestSignIn(fetchImpl, 'ada@example.test', 'Str0ngPass!23');
    expect(outcome).toEqual({ kind: 'emailNotConfirmed', email: 'ada@example.test' });
  });

  it('throws Go\'s error message on a rejected login, unmodified', async () => {
    const fetchImpl = fakeFetch(401, { error: 'invalid credentials' });
    await expect(requestSignIn(fetchImpl, 'ada@example.test', 'wrong')).rejects.toMatchObject({
      message: 'invalid credentials',
      status: 401,
    });
  });

  it('throws when the response has no session and no mfaRequired/emailNotConfirmed signal', async () => {
    const fetchImpl = fakeFetch(200, { success: true });
    await expect(requestSignIn(fetchImpl, 'ada@example.test', 'x')).rejects.toBeInstanceOf(AuthRequestError);
  });
});

describe('requestSignUp', () => {
  it('calls /api/auth/register, not Supabase, with fullName/email/password', async () => {
    const fetchImpl = fakeFetch(200, {
      user: { id: 'u-1', email: 'ada@example.test' },
      tokens: { accessToken: '', refreshToken: '' },
      needsVerification: true,
    });

    const outcome = await requestSignUp(fetchImpl, {
      fullName: 'Ada Obi',
      email: 'ada@example.test',
      password: 'Str0ngPass!23',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({ fullName: 'Ada Obi', email: 'ada@example.test', password: 'Str0ngPass!23' });

    expect(outcome).toEqual({ kind: 'needsVerification', email: 'ada@example.test' });
  });

  it('returns a session outcome when the backend skips verification', async () => {
    const fetchImpl = fakeFetch(200, {
      user: { id: 'u-2' },
      tokens: { accessToken: 'at', refreshToken: 'rt' },
      needsVerification: false,
    });

    const outcome = await requestSignUp(fetchImpl, {
      fullName: 'A B', email: 'a@b.test', password: 'Str0ngPass!23',
    });
    expect(outcome).toEqual({ kind: 'session', tokens: { accessToken: 'at', refreshToken: 'rt' } });
  });

  it('throws the proxy error without enrichment', async () => {
    const fetchImpl = fakeFetch(400, { error: 'Registration failed. Please check your details and try again.' });
    await expect(
      requestSignUp(fetchImpl, { fullName: 'A B', email: 'a@b.test', password: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('requestLoginOtpVerify', () => {
  it('calls /api/auth/otp-verify with email+code and returns the session', async () => {
    const fetchImpl = fakeFetch(200, {
      success: true,
      session: { access_token: 'at2', refresh_token: 'rt2' },
      tokens: { accessToken: 'at2', refreshToken: 'rt2' },
    });

    const tokens = await requestLoginOtpVerify(fetchImpl, 'ada@example.test', '123456');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/otp-verify');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ada@example.test', code: '123456' });
    expect(tokens).toEqual({ accessToken: 'at2', refreshToken: 'rt2' });
  });

  it('throws on a wrong or expired code', async () => {
    const fetchImpl = fakeFetch(401, { error: 'invalid or expired code' });
    await expect(requestLoginOtpVerify(fetchImpl, 'ada@example.test', '000000'))
      .rejects.toMatchObject({ status: 401 });
  });
});

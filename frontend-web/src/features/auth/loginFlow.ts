/**
 * Sign-in / sign-up request logic for app/login/page.tsx, pulled out so it can
 * be pinned by a test without a browser or a real Supabase client.
 *
 * AUTH-016: this page used to call supabase.auth.signInWithPassword() and
 * supabase.auth.signUp() directly from the browser, which skipped the Go
 * backend entirely — no lockout, no rate limiting, no OTP-login step-up, no
 * audit event, no referral attribution. These functions call the Next.js proxy
 * routes instead (/api/auth/login, /api/auth/register, /api/auth/otp-verify),
 * which forward to Go — the same pattern mobile-app/reactnative/src/api/auth.api.ts
 * already uses.
 *
 * Adopting the returned session (supabase.auth.setSession) needs the real
 * Supabase client, so that step stays in the page component; everything here is
 * pure request/response shaping and takes its fetch as a parameter.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SessionTokens = { accessToken: string; refreshToken: string };

/** Thrown for any non-2xx response that isn't one of the named outcomes below. */
export class AuthRequestError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

// The login/otp-verify proxies return the session in two shapes depending on
// which upstream answered (see app/api/auth/login/route.ts) — read either.
function readTokens(body: unknown): SessionTokens | null {
  const b = body as {
    tokens?: { accessToken?: unknown; refreshToken?: unknown };
    session?: { access_token?: unknown; refresh_token?: unknown };
  } | null;
  const accessToken = b?.tokens?.accessToken ?? b?.session?.access_token;
  const refreshToken = b?.tokens?.refreshToken ?? b?.session?.refresh_token;
  if (typeof accessToken === 'string' && accessToken && typeof refreshToken === 'string' && refreshToken) {
    return { accessToken, refreshToken };
  }
  return null;
}

export type SignInOutcome =
  | { kind: 'session'; tokens: SessionTokens }
  // The password was correct; a second factor is required. Same shape Go's
  // FEATURE_OTP_LOGIN_MFA_ENABLED step-up returns via /api/auth/login.
  | { kind: 'mfaRequired'; email: string; message?: string }
  // The password was correct; only verification is missing. Mirrors the
  // Supabase `email_not_confirmed` code this page already special-cased.
  | { kind: 'emailNotConfirmed'; email: string };

export async function requestSignIn(
  fetchImpl: FetchLike,
  identifier: string,
  password: string,
): Promise<SignInOutcome> {
  const res = await fetchImpl('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 403 && (body as { code?: string } | null)?.code === 'email_not_confirmed') {
      return { kind: 'emailNotConfirmed', email: identifier };
    }
    throw new AuthRequestError(
      (body as { error?: string } | null)?.error || 'Sign in failed. Please try again.',
      res.status,
    );
  }

  if ((body as { mfaRequired?: boolean } | null)?.mfaRequired) {
    const b = body as { message?: string };
    return { kind: 'mfaRequired', email: identifier, message: b.message };
  }

  const tokens = readTokens(body);
  if (!tokens) throw new AuthRequestError('Sign in failed. Please try again.');
  return { kind: 'session', tokens };
}

export type SignUpOutcome =
  | { kind: 'session'; tokens: SessionTokens }
  // No session came back — confirmation is required, matching the old
  // `data?.session?.access_token` check this page used against Supabase.
  | { kind: 'needsVerification'; email: string };

export async function requestSignUp(
  fetchImpl: FetchLike,
  params: { fullName: string; email: string; password: string; referralCode?: string },
): Promise<SignUpOutcome> {
  const res = await fetchImpl('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: params.fullName,
      email: params.email,
      password: params.password,
      referralCode: params.referralCode ?? '',
    }),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new AuthRequestError(
      (body as { error?: string } | null)?.error || 'Sign up failed. Please try again.',
      res.status,
    );
  }

  const tokens = readTokens(body);
  if (tokens) return { kind: 'session', tokens };
  return { kind: 'needsVerification', email: params.email };
}

/** Redeems the login second factor issued by requestSignIn's `mfaRequired` outcome. */
export async function requestLoginOtpVerify(
  fetchImpl: FetchLike,
  email: string,
  code: string,
): Promise<SessionTokens> {
  const res = await fetchImpl('/api/auth/otp-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new AuthRequestError(
      (body as { error?: string } | null)?.error || 'Verification failed. Please try again.',
      res.status,
    );
  }

  const tokens = readTokens(body);
  if (!tokens) throw new AuthRequestError('Sign in failed. Please try again.');
  return tokens;
}

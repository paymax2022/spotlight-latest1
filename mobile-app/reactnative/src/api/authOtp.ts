/**
 * Request shaping and response reading for the OTP auth calls.
 *
 * Split out of auth.api.ts because that module pulls in the Supabase client and,
 * through it, React Native polyfills — so nothing in it can be exercised by the
 * node test runner. The parts worth pinning are pure: which endpoint each call
 * goes to, how the address is normalised, and the one place the two verification
 * backends differ. They live here so they can be tested without a simulator.
 */

export const OTP_ROUTES = {
  /** Confirms a SIGN-UP code. Returns no session on the server-issued path. */
  verifyEmail: '/api/auth/verify-otp',
  /** Re-issues a sign-up code. */
  resend: '/api/auth/resend-otp',
  /** Starts a reset — sends BOTH the Supabase link and our code. */
  forgotPassword: '/api/auth/forgot-password',
  /** Completes a reset, with either the code or the link session. */
  resetPassword: '/api/auth/reset-password',
  /** Redeems the LOGIN second factor. Returns a session. */
  loginStepUp: '/api/auth/otp-verify',
} as const;

/** Addresses are matched case-insensitively server-side; normalise once, here. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function verifyEmailBody(email: string, otp: string) {
  return { email: normaliseEmail(email), otp: otp.trim() };
}

export function resendBody(email: string) {
  return { email: normaliseEmail(email) };
}

export function forgotPasswordBody(email: string) {
  return { email: normaliseEmail(email) };
}

export function resetWithCodeBody(email: string, code: string, password: string) {
  return { email: normaliseEmail(email), code: code.trim(), password };
}

export function loginStepUpBody(email: string, otp: string) {
  return { email: normaliseEmail(email), code: otp.trim() };
}

/**
 * Whether a reset request carries a CODE rather than relying on the link's
 * recovery session. Both are live: the reset email sends both mechanisms, so a
 * user may arrive holding either.
 */
export function isCodeReset(payload: { email?: string; code?: string }): boolean {
  return Boolean(payload.email && payload.code);
}

type Sessionish = { access_token?: unknown; refresh_token?: unknown } | undefined | null;

/** Extracts a usable token pair, or null. */
export function readSession(session: Sessionish): { accessToken: string; refreshToken: string } | null {
  const accessToken = typeof session?.access_token === 'string' ? session.access_token : '';
  const refreshToken = typeof session?.refresh_token === 'string' ? session.refresh_token : '';
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/**
 * Whether verification also SIGNED THE USER IN.
 *
 * The two backends differ here and the UI must branch: Supabase's signup OTP
 * establishes a session, the server-issued one confirms the account and stops,
 * because control of a mailbox is not proof of the password. A caller that
 * assumes a session would call getMe() without one and show an error after a
 * verification that actually succeeded.
 *
 * Requires BOTH the flag and real tokens — a response claiming signedIn with no
 * tokens is not a session.
 */
export function verificationSignedIn(body: {
  signedIn?: unknown;
  tokens?: { accessToken?: unknown; refreshToken?: unknown };
}): boolean {
  if (body?.signedIn !== true) return false;
  const { accessToken, refreshToken } = body.tokens ?? {};
  return typeof accessToken === 'string' && accessToken !== ''
    && typeof refreshToken === 'string' && refreshToken !== '';
}

/** Whether a login response is a second-factor challenge rather than a session. */
export function isMfaChallenge(body: { mfaRequired?: unknown }): boolean {
  return body?.mfaRequired === true;
}

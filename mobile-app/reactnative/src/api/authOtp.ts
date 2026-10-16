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
  /** Starts a reset: emails a one-time code (never a link). Takes email OR phone. */
  forgotPassword: '/api/auth/forgot-password',
  /** Checks the emailed code; answers with a single-use resetToken. */
  verifyResetCode: '/api/auth/verify-password-reset-otp',
  /** Sets the new password, authorised by the resetToken. */
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

/**
 * A reset identifier is an email OR a phone number. Emails are lowercased (the
 * server keys on that); anything else is only trimmed — the server owns phone
 * normalisation, and guessing here would mangle formats it accepts.
 */
export function normaliseIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

export function forgotPasswordBody(identifier: string) {
  return { identifier: normaliseIdentifier(identifier) };
}

/**
 * The reset request answers 404 `account_not_found` when nothing matches what
 * the user typed (ADR-PR800). Returns the sentence to show, naming what they
 * typed so a typo is obvious, or null for any other failure so the caller falls
 * back to its generic error mapping.
 */
export function accountNotFoundMessage(err: unknown, identifier: string): string | null {
  const res = (err as { response?: { status?: unknown; data?: { error?: unknown } } } | undefined)?.response;
  if (res?.status !== 404 || res?.data?.error !== 'account_not_found') return null;
  return `No account found for ${normaliseIdentifier(identifier)}.`;
}

export function verifyResetCodeBody(identifier: string, code: string) {
  return { identifier: normaliseIdentifier(identifier), code: code.trim() };
}

export function resetWithTokenBody(identifier: string, resetToken: string, password: string) {
  return { identifier: normaliseIdentifier(identifier), resetToken, password };
}

/**
 * Holds the proof that the reset code was correct, between the code screen and the
 * new-password screen. In memory ONLY: a route param would put the token in
 * navigation state and deep links, and persisting it would outlive the 10-minute
 * server TTL. Losing it (app killed) just means starting the reset again.
 */
let pendingReset: { identifier: string; resetToken: string } | null = null;

export function setPendingReset(identifier: string, resetToken: string): void {
  pendingReset = { identifier: normaliseIdentifier(identifier), resetToken };
}

export function getPendingReset(): { identifier: string; resetToken: string } | null {
  return pendingReset;
}

export function clearPendingReset(): void {
  pendingReset = null;
}

export function loginStepUpBody(email: string, otp: string) {
  return { email: normaliseEmail(email), code: otp.trim() };
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

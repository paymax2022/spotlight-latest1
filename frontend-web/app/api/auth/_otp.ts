/**
 * Shared plumbing for talking to the Go backend's server-issued OTP endpoints.
 *
 * WHY EVERY CALLER FALLS BACK
 * ---------------------------
 * FEATURE_OTP_EMAIL_ENABLED is OFF by default and cannot be turned on until a
 * Brevo account exists. While it is off, Go answers these routes with 503 and
 * verification still runs entirely through Supabase Auth.
 *
 * So the routes here try Go first and fall back to the Supabase call they used
 * to make. That makes the cutover a server-side flag flip with no client
 * deploy — and, more importantly, means shipping this cannot break the login
 * and sign-up flows of an environment where the flag is off.
 *
 * The fallback is DELIBERATELY NARROW. It fires only when Go says the feature is
 * closed, or when Go cannot be reached at all. It must never fire on a real
 * rejection: a wrong code answered 400 by Go has to stay a wrong code, not be
 * re-asked of Supabase — which would answer about a code it never issued, and
 * turn "that code is wrong" into a confusing second error.
 */

const GO_BACKEND_URL = process.env.GO_BACKEND_URL || 'http://localhost:8080';
const TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 20_000);

export type GoResult =
  | { kind: 'answered'; status: number; body: Record<string, unknown> }
  /** Go is not serving this feature, or is unreachable — use the Supabase path. */
  | { kind: 'fallback'; reason: string };

/** Purposes the Go OTP service accepts. `login` is not self-issuable. */
export type OtpPurpose = 'verify_email' | 'password_reset' | 'login';

export async function callGo(path: string, body: unknown): Promise<GoResult> {
  let upstream: Response;
  try {
    upstream = await fetch(`${GO_BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    // Unreachable or timed out. The Supabase path is what production does today,
    // so preferring it here keeps an outage in the new service from taking sign-up
    // down with it.
    return { kind: 'fallback', reason: `upstream unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const payload = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;

  if (upstream.status === 503) {
    // feature_disabled, misconfigured_missing_credentials, misconfigured_no_database…
    const reason = typeof payload?.error === 'string' ? payload.error : 'feature closed';
    return { kind: 'fallback', reason };
  }

  return { kind: 'answered', status: upstream.status, body: payload ?? {} };
}

/**
 * Maps a Go OTP failure onto a message for the caller.
 *
 * Go already distinguishes only what a user can act on — expired and locked out
 * are separate, everything else is "invalid code" — so this passes its wording
 * through rather than inventing a richer vocabulary the backend deliberately
 * refuses to provide.
 */
export function goErrorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
}

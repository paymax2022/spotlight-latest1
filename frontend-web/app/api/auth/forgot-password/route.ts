import { NextResponse } from 'next/server';
import { callGo, resetUnavailable } from '../_otp';

/**
 * POST /api/auth/forgot-password — step 1 of a password reset.
 *
 * Reset is an emailed ONE-TIME CODE, never a link:
 *   1. this route        { identifier }                          → code emailed
 *   2. verify-password-reset-otp { identifier, code }            → { resetToken }
 *   3. reset-password    { identifier, resetToken, password }    → password set
 *
 * `identifier` is an email OR a phone number. A phone number is resolved to its
 * account SERVER-SIDE and the code goes to that account's email; the address is
 * never returned, because a public phone → email lookup would let anyone harvest
 * addresses. `email` is still accepted as an alias for older clients.
 *
 * There is deliberately NO Supabase fallback. It used to send Supabase's reset
 * link when Go was unreachable; that link is exactly what this flow replaces, and
 * quietly sending it would put an undocumented second mechanism back. If codes are
 * unavailable the caller is told so (503) — that is a property of the environment,
 * identical for every identifier, so it reveals nothing about accounts.
 *
 * Product decision (ADR-PR801): THIS step tells the user when no account matches
 * (404 account_not_found), so a mistyped address is caught here instead of after
 * a code that never comes. That discloses whether an email/phone is registered;
 * the per-IP reset limiter is the brake. Other upstream failures are still
 * swallowed into the neutral answer, and verify/reset still answer identically
 * for every identifier. 429 is passed through for the same reason as before: it
 * is per client IP, and a throttled user would otherwise wait for an email that
 * is never coming.
 */
export async function POST(request: Request) {
  try {
    // Malformed JSON must not reach the catch-all, which would answer 500 with
    // the parser's message. Same pattern as ../login: null falls into the
    // field checks and a clean 400.
    const body = await request.json().catch(() => null);
    const identifier = String(body?.identifier ?? body?.email ?? '').trim();

    if (!identifier) {
      return NextResponse.json({ error: 'Email or phone number is required' }, { status: 400 });
    }

    const go = await callGo('/api/auth/request-password-reset', { identifier }, request);
    if (go.kind === 'fallback') {
      console.info('[auth/forgot-password] codes unavailable:', go.reason);
      return resetUnavailable();
    }
    if (go.status === 429) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 },
      );
    }
    if (go.status === 404) {
      return NextResponse.json(
        { error: 'account_not_found', message: 'No account found for that email or phone number.' },
        { status: 404 },
      );
    }
    if (go.status >= 400) {
      // Logged, never surfaced: the caller gets the same answer either way.
      console.error('[auth/forgot-password] upstream returned', go.status);
    }
    return NextResponse.json({
      message: 'If an account matches, a reset code was sent to its email.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send reset code' }, { status: 500 });
  }
}

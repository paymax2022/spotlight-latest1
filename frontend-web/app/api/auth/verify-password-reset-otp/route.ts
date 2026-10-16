import { NextResponse } from 'next/server';
import { callGo, goErrorMessage, resetUnavailable } from '../_otp';

/**
 * POST /api/auth/verify-password-reset-otp — step 2 of a password reset.
 *
 * Checks the emailed code and, only if it is right, returns a `resetToken` that
 * unlocks step 3. It changes no password. Doing the check here (rather than at the
 * final submit) is what lets the client show the new-password form ONLY after the
 * code has been validated.
 *
 * The code is single-use, so the token is how "the code was correct" travels to
 * the next step without the code being checked twice. It is single-use, bound to
 * the identifier, and short-lived.
 *
 * A wrong code is final: there is no fallback to Supabase, which never issued it.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const identifier = String(body?.identifier ?? body?.email ?? '').trim();
    const code = String(body?.code ?? '').trim();

    if (!identifier || !code) {
      return NextResponse.json({ error: 'Identifier and code are required' }, { status: 400 });
    }

    const go = await callGo('/api/auth/verify-password-reset-otp', { identifier, code }, request);
    if (go.kind === 'fallback') {
      console.info('[auth/verify-password-reset-otp] codes unavailable:', go.reason);
      return resetUnavailable();
    }
    if (go.status >= 400) {
      return NextResponse.json(
        { error: goErrorMessage(go.body, 'Could not verify the code') },
        { status: go.status },
      );
    }
    const resetToken = typeof go.body.resetToken === 'string' ? go.body.resetToken : '';
    if (!resetToken) {
      // Go said OK but sent nothing to continue with. Never present that as a pass.
      return NextResponse.json({ error: 'Could not verify the code' }, { status: 502 });
    }
    return NextResponse.json({ verified: true, resetToken });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Could not verify the code' }, { status: 500 });
  }
}

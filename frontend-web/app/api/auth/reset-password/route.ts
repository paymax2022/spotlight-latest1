import { NextResponse } from 'next/server';
import { callGo, goErrorMessage, resetUnavailable } from '../_otp';

/**
 * POST /api/auth/reset-password — step 3 of a password reset.
 *
 *   { identifier, resetToken, password }
 *
 * `resetToken` is what verify-password-reset-otp returned once the emailed code
 * was checked, so this can only be reached after that. There is no longer a
 * "recovery link session" form of this call: reset is the emailed code only.
 *
 * The password length is checked HERE, before Go is asked to spend the token, so a
 * too-short password costs the user a retry rather than their verified code.
 */
export async function POST(request: Request) {
  try {
    // Malformed JSON must not reach the catch-all, which would answer 500 with
    // the parser's message. Same pattern as ../login: null falls into the
    // field checks and a clean 400.
    const body = await request.json().catch(() => null);
    const password: string | undefined = body?.password ?? body?.newPassword;
    const identifier = String(body?.identifier ?? body?.email ?? '').trim();
    const resetToken = String(body?.resetToken ?? '').trim();

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (!identifier || !resetToken) {
      return NextResponse.json({ error: 'Verify the code we emailed you first.' }, { status: 400 });
    }

    const go = await callGo('/api/auth/reset-password', {
      identifier,
      resetToken,
      newPassword: password,
    }, request);

    if (go.kind === 'fallback') {
      console.info('[auth/reset-password] codes unavailable:', go.reason);
      return resetUnavailable();
    }
    if (go.status >= 400) {
      return NextResponse.json(
        { error: goErrorMessage(go.body, 'Password reset failed') },
        { status: go.status },
      );
    }
    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Password reset failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';
import { callGo, goErrorMessage } from '../_otp';

/**
 * POST /api/auth/otp-verify — redeems the LOGIN second-factor code and returns
 * the session.
 *
 * Separate from /api/auth/verify-otp, which confirms a sign-up and deliberately
 * returns no session. This one does the opposite, so keeping them apart means a
 * caller cannot obtain a session from the sign-up route by changing one field.
 *
 * There is no Supabase fallback: a login code only exists when the Go step-up
 * issued it, so if that feature is closed there is nothing to redeem and saying
 * so plainly beats asking Supabase about a code it never minted.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, code } = body ?? {};

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
    }

    const go = await callGo('/api/auth/otp/verify', {
      email: String(email).trim().toLowerCase(),
      code: String(code).trim(),
      purpose: 'login',
    });

    if (go.kind === 'fallback') {
      console.info('[auth/otp-verify] step-up unavailable:', go.reason);
      return NextResponse.json(
        { error: 'Sign-in codes are unavailable. Please try again shortly.' },
        { status: 503 },
      );
    }
    if (go.status >= 400) {
      return NextResponse.json(
        { error: goErrorMessage(go.body, 'Verification failed') },
        { status: go.status },
      );
    }

    const session = (go.body?.session ?? {}) as Record<string, unknown>;
    const accessToken = typeof session.access_token === 'string' ? session.access_token : '';
    const refreshToken = typeof session.refresh_token === 'string' ? session.refresh_token : '';
    if (!accessToken || !refreshToken) {
      console.error('[auth/otp-verify] upstream verified the code but returned no session');
      return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 502 });
    }

    // Same legacy shape /api/auth/login returns, so a caller finishing a step-up
    // lands on exactly the payload it already knows how to consume.
    let user: unknown = null;
    try {
      const anon = createAnonClient();
      const { data: got } = await anon.auth.getUser(accessToken);
      if (got?.user) {
        const admin = createServiceClient();
        const { data: profile } = await admin
          .from('user_profiles')
          .select('full_name, phone, kyc_status')
          .eq('id', got.user.id)
          .maybeSingle();
        user = formatUser(got.user, profile);
      }
    } catch (err) {
      // Sign-in has already succeeded; a profile lookup must not undo it.
      console.error('[auth/otp-verify] profile lookup failed after a successful sign-in:',
        err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      success: true,
      session,
      tokens: { accessToken, refreshToken },
      user,
      message: 'Login successful',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Verification failed' }, { status: 500 });
  }
}

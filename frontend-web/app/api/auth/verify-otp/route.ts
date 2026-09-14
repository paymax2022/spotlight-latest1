import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';
import { callGo, goErrorMessage } from '../_otp';

/**
 * POST /api/auth/verify-otp — confirms a sign-up code.
 *
 * Go first, Supabase as the fallback (see ../_otp.ts for why both exist).
 *
 * THE TWO PATHS DIFFER IN ONE WAY THE CALLER MUST HANDLE: Supabase's
 * verifyOtp('signup') SIGNS THE USER IN and returns a session. Go's does not —
 * it confirms the account and stops, deliberately, because proving control of a
 * mailbox is not proof of the password. So the response carries `signedIn`, and
 * a caller that navigates straight to a logged-in screen must branch on it or it
 * will land there with no session.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, otp } = body ?? {};

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    const go = await callGo('/api/auth/otp/verify', {
      email: String(email).trim().toLowerCase(),
      code: String(otp).trim(),
      purpose: 'verify_email',
    });

    if (go.kind === 'answered') {
      if (go.status >= 400) {
        // A real rejection — a wrong or expired code. Passed through verbatim
        // rather than re-asked of Supabase, which never issued this code.
        return NextResponse.json(
          { error: goErrorMessage(go.body, 'Verification failed') },
          { status: go.status },
        );
      }
      return NextResponse.json({
        verified: true,
        signedIn: false,
        // Kept for shape compatibility with the Supabase path; deliberately empty.
        tokens: { accessToken: '', refreshToken: undefined },
        message: 'Email verified. Please sign in.',
      });
    }

    console.info('[auth/verify-otp] using the Supabase path:', go.reason);

    const anon = createAnonClient();
    // 'signup', not 'email'. Supabase uses 'email' for an email-CHANGE
    // confirmation and 'signup' for the code sent on registration, which is what
    // this route is for.
    const { data, error } = await anon.auth.verifyOtp({
      email,
      token: otp,
      type: 'signup',
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
    }

    const { session, user } = data;

    const admin = createServiceClient();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, kyc_status')
      .eq('id', user!.id)
      .maybeSingle();

    return NextResponse.json({
      verified: true,
      signedIn: Boolean(session?.access_token),
      user: formatUser(user, profile),
      tokens: {
        accessToken: session?.access_token ?? '',
        refreshToken: session?.refresh_token ?? undefined,
      },
      message: 'Email verified successfully',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Verification failed' }, { status: 500 });
  }
}

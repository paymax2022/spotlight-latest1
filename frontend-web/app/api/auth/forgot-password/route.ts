import { NextResponse } from 'next/server';
import { createAnonClient } from '../_supabase';
import { callGo } from '../_otp';

/**
 * POST /api/auth/forgot-password — starts a password reset.
 *
 * Prefers the Go backend because that endpoint sends BOTH mechanisms: Supabase's
 * reset link (unchanged) and our own code. Calling Supabase directly would send
 * only the link, so a user could never complete the code form.
 *
 * Falls back to Supabase alone when Go is unreachable — the link on its own is
 * still a working reset.
 *
 * The response is IDENTICAL whether or not an account exists, and identical on
 * failure. Anything else turns the reset form into an account-enumeration oracle,
 * which is the same reason the Go endpoint swallows its own upstream 4xx.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const accepted = () => NextResponse.json({
      message: 'If an account exists for that address, reset instructions were sent.',
    });

    const go = await callGo('/api/auth/request-password-reset', {
      email: String(email).trim().toLowerCase(),
    });
    if (go.kind === 'answered') {
      // Go answers 200 regardless; a non-200 is logged, never surfaced.
      if (go.status >= 400) {
        console.error('[auth/forgot-password] upstream returned', go.status);
      }
      return accepted();
    }

    console.info('[auth/forgot-password] using the Supabase path:', go.reason);

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com'}/auth/reset-password`;
    const anon = createAnonClient();
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      // Logged, not returned: a distinguishable failure would reveal which
      // addresses have accounts.
      console.error('[auth/forgot-password] supabase fallback failed:', error.message);
    }
    return accepted();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send reset email' }, { status: 500 });
  }
}

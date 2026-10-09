import { NextResponse } from 'next/server';
import { createAnonClient } from '../_supabase';
import { callGo } from '../_otp';

/**
 * POST /api/auth/resend-otp — re-issues a sign-up verification code.
 *
 * Go first, Supabase as the fallback (see ../_otp.ts).
 *
 * The response is IDENTICAL for every outcome: sent, throttled, or no such
 * account. Passing Go's 429 through — as this used to — made the resend form
 * an account-enumeration oracle: an existing unverified account hits the
 * per-address cooldown and answers 429, while an unknown address answers 200.
 * Same reason /api/auth/forgot-password swallows its upstream failures.
 *
 * The throttle is still enforced where it lives: Go (or Supabase) simply does
 * not send the second email. Only the caller's answer is uniform.
 */
export async function POST(request: Request) {
  try {
    // Malformed JSON must not reach the catch-all, which would answer 500 with
    // the parser's message. Same pattern as ../login: null falls into the
    // field checks and a clean 400.
    const body = await request.json().catch(() => null);
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const sent = () => NextResponse.json({ message: 'Verification code resent to your email' });

    const go = await callGo('/api/auth/otp/request', {
      email: String(email).trim().toLowerCase(),
      purpose: 'verify_email',
    }, request);

    if (go.kind === 'answered') {
      // Logged, not returned — a distinguishable 429 reveals which addresses
      // have accounts. And it must NOT fall back on a rejection: resending via
      // Supabase would send a second email and defeat the cooldown.
      if (go.status >= 400) {
        console.error('[auth/resend-otp] upstream returned', go.status);
      }
      return sent();
    }

    console.info('[auth/resend-otp] using the Supabase path:', go.reason);

    const anon = createAnonClient();
    const { error } = await anon.auth.resend({ type: 'signup', email });
    if (error) {
      // Same enumeration channel — Supabase's resend distinguishes a throttled
      // address from an unknown one. Logged, not returned.
      console.error('[auth/resend-otp] supabase fallback failed:', error.message);
    }

    return sent();
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to resend code' }, { status: 500 });
  }
}

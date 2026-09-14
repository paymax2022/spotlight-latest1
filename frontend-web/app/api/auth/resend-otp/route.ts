import { NextResponse } from 'next/server';
import { createAnonClient } from '../_supabase';
import { callGo, goErrorMessage } from '../_otp';

/**
 * POST /api/auth/resend-otp — re-issues a sign-up verification code.
 *
 * Go first, Supabase as the fallback (see ../_otp.ts).
 *
 * Go answers 429 when the per-address cooldown or the hourly budget is spent.
 * That is passed through: a user who is told "sent" and receives nothing has no
 * way to tell the difference between a throttle and a delivery failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const go = await callGo('/api/auth/otp/request', {
      email: String(email).trim().toLowerCase(),
      purpose: 'verify_email',
    });

    if (go.kind === 'answered') {
      if (go.status >= 400) {
        return NextResponse.json(
          { error: goErrorMessage(go.body, 'Failed to resend code') },
          { status: go.status },
        );
      }
      return NextResponse.json({ message: 'Verification code resent to your email' });
    }

    console.info('[auth/resend-otp] using the Supabase path:', go.reason);

    const anon = createAnonClient();
    const { error } = await anon.auth.resend({ type: 'signup', email });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }

    return NextResponse.json({ message: 'Verification code resent to your email' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to resend code' }, { status: 500 });
  }
}

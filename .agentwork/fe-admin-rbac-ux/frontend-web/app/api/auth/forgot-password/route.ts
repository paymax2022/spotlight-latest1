import { NextResponse } from 'next/server';
import { createAnonClient } from '../_supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spotlightng.com'}/auth/reset-password`;

    const anon = createAnonClient();
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }

    return NextResponse.json({ message: 'Password reset instructions sent to your email' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send reset email' }, { status: 500 });
  }
}

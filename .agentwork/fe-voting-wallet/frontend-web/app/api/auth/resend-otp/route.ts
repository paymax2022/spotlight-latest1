import { NextResponse } from 'next/server';
import { createAnonClient } from '../_supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body ?? {};

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

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

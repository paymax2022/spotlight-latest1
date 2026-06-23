import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, otp } = body ?? {};

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    const anon = createAnonClient();
    const { data, error } = await anon.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
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

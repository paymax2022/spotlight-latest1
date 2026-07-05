import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';
import { attributeSignup } from '@/src/server/referrals/attribution';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fullName, email, phone, password, referralCode } = body ?? {};

    if (!fullName || !email || !password) {
      return NextResponse.json({ error: 'Full name, email, and password are required' }, { status: 400 });
    }

    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone: phone ?? '' } },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }

    const { session, user } = data;
    if (!user) {
      return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
    }

    // Upsert user_profiles so the row exists immediately
    const admin = createServiceClient();
    await admin.from('user_profiles').upsert(
      { id: user.id, email, full_name: fullName, phone: phone ?? '' },
      { onConflict: 'id' },
    );

    // §7A: attribute the signup (valid code → referrer; else → house). Never
    // block signup on attribution failure.
    try {
      await attributeSignup(user.id, { referralCode: referralCode ?? null });
    } catch (attribErr) {
      console.error('[register] referral attribution failed (non-fatal):', attribErr);
    }

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, kyc_status')
      .eq('id', user.id)
      .maybeSingle();

    return NextResponse.json({
      user: formatUser(user, profile),
      tokens: {
        accessToken: session?.access_token ?? '',
        refreshToken: session?.refresh_token ?? undefined,
      },
      message: 'Account created successfully',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Registration failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createAnonClient, createServiceClient, formatUser } from '../_supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body ?? {};

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const anon = createAnonClient();
    const { data, error } = await anon.auth.signInWithPassword({ email, password });

    if (error) {
      const status = error.status === 400 ? 401 : (error.status ?? 500);
      return NextResponse.json({ error: error.message }, { status });
    }

    const { session, user } = data;

    // Fetch profile for full_name / phone
    const admin = createServiceClient();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, kyc_status')
      .eq('id', user.id)
      .maybeSingle();

    return NextResponse.json({
      user: formatUser(user, profile),
      tokens: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
      message: 'Login successful',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Login failed' }, { status: 500 });
  }
}

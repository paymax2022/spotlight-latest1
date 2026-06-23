import { NextResponse } from 'next/server';
import { createServiceClient, extractBearerToken, formatUser } from '../_supabase';

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createServiceClient();
    const { data: { user }, error } = await admin.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name, phone, kyc_status')
      .eq('id', user.id)
      .maybeSingle();

    return NextResponse.json({ data: formatUser(user, profile) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch user' }, { status: 500 });
  }
}

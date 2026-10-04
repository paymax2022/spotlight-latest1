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
      // E2E-PERF-063: only a definitive rejection is a 401. A GoTrue 5xx or
      // transport failure folded into 401 makes a backend blip look like
      // session expiry (clients log the user out) — surface it as 503
      // instead, mirroring the Go middleware's ErrTokenInvalid-vs-upstream
      // split.
      const upstream = error && (typeof error.status !== 'number' || error.status >= 500);
      return NextResponse.json(
        { error: upstream ? 'Authentication service unavailable' : 'Unauthorized' },
        { status: upstream ? 503 : 401 },
      );
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

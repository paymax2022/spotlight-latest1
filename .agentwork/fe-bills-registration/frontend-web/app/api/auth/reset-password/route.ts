import { NextResponse } from 'next/server';
import { createServiceClient, extractBearerToken } from '../_supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body ?? {};

    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // The mobile sends the recovery access token as the Bearer header
    // after the user follows the reset link (deep-linked back into the app).
    const token = extractBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Reset token is required' }, { status: 400 });
    }

    const admin = createServiceClient();

    // Validate the token and get the user
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 401 });
    }

    // Update password via admin API
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Password reset failed' }, { status: 500 });
  }
}

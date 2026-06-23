import { NextResponse } from 'next/server';
import { createServiceClient, extractBearerToken } from '../_supabase';

export async function POST(request: Request) {
  try {
    const token = extractBearerToken(request);
    if (token) {
      const admin = createServiceClient();
      // Resolve the user then invalidate their session server-side
      const { data: { user } } = await admin.auth.getUser(token);
      if (user) {
        await admin.auth.admin.signOut(user.id);
      }
    }
    return NextResponse.json({ message: 'Logged out successfully' });
  } catch {
    // Always return success — mobile clears local tokens regardless
    return NextResponse.json({ message: 'Logged out' });
  }
}

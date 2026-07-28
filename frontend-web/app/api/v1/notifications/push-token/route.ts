import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/v1/notifications/push-token — upsert a device push token for the caller.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const body = await request.json();
    const token: string = String(body?.token ?? '').trim();
    const platform: string = String(body?.platform ?? '').trim();

    if (!token) throw new ApiError('token is required', 400);
    if (!['ios', 'android', 'web'].includes(platform)) {
      throw new ApiError('platform must be ios, android, or web', 400);
    }

    const { error } = await supabase.from('device_push_tokens').upsert(
      {
        user_id: user.id,
        token,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
    if (error) throw error;

    return NextResponse.json(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to register push token');
  }
}

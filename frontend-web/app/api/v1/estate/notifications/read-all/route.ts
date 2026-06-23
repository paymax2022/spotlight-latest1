import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/v1/estate/notifications/read-all — mark all unread as read.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { error } = await supabase.from('estate_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id).is('read_at', null);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) { return handleApiError(error, 'Failed to mark all read'); }
}

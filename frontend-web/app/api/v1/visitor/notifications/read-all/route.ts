import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/v1/visitor/notifications/read-all — mark all notifications as read.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { error } = await supabase
      .from('visitor_notifications')
      .update({ read: true })
      .eq('user_id', user.id);
    if (error) throw error;

    return NextResponse.json(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to mark notifications as read');
  }
}

import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/v1/visitor/notifications/unread-count — count of unread notifications.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { count, error } = await supabase
      .from('visitor_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false);
    if (error) throw error;

    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    return handleApiError(error, 'Failed to count unread notifications');
  }
}

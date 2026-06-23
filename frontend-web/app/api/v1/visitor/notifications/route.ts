import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapNotification } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/notifications — notifications for the caller, newest first.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { data: rows, error } = await supabase
      .from('visitor_notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json((rows ?? []).map(mapNotification));
  } catch (error) {
    return handleApiError(error, 'Failed to load notifications');
  }
}

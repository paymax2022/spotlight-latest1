import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

// GET /api/v1/estate/notifications/unread-count — the badge.
//
// Counted over the active inbox only, so the number a tab shows matches the first page of the feed:
// archiving a notice takes it out of the inbox, and it would be misleading for the badge to keep
// pointing at a row the recipient put away (EST-UAT-0359).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const resident = await getResidentContext(supabase, user.id);
    if (!resident) return NextResponse.json({ count: 0 });

    const { count, error } = await supabase
      .from('estate_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('estate_id', resident.estateId)
      .eq('user_id', user.id)
      .is('read_at', null)
      .is('archived_at', null);
    if (error) throw error;

    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    return handleApiError(error, 'Failed to count unread notifications');
  }
}

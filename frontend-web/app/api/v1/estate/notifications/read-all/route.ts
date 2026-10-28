import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

// POST /api/v1/estate/notifications/read-all — stamp the caller's unread INBOX rows read.
//
// The archive half is deliberately out of reach: marking an archived notice read would move a date the
// retention sweep keys on, on a row the recipient has already put away. read_at is written once, so this
// only ever touches rows where it is still null.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const resident = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!resident) throw new ApiError('Not a resident of any estate', 403);

    const { error } = await supabase.from('estate_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('estate_id', resident.estateId)
      .eq('user_id', user.id)
      .is('read_at', null)
      .is('archived_at', null);
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) { return handleApiError(error, 'Failed to mark all read'); }
}

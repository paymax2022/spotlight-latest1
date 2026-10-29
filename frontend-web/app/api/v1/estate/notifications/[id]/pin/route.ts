import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { NOTIF_UUID_RE, patchOwnNotification } from '@/src/server/estate/notifications';

// POST /api/v1/estate/notifications/[id]/pin {pinned, user_id?} — mark one notice must-not-sweep.
//
// A member pins their own copy. An estate admin may pin a member's copy (optionally naming them with
// user_id) because a pin is a retention decision, not a personal tidying of somebody's inbox: it is what
// keeps a notice out of the archive sweep and, through the guard trigger in
// 20271099000070_estate_notifications_archive.sql, out of a purge as well.
//
// The answers mirror the Go service (notifications_retention.go SetNotificationPinned): a member naming
// somebody else is forbidden, and a row that is not that recipient's in this estate is "not found" — the
// same answer as "does not exist", because telling them apart would confirm somebody's inbox contents.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await ctx.params;
    if (!NOTIF_UUID_RE.test(id)) throw new ApiError('Invalid notification ID', 400);

    const body: any = await request.json().catch(() => ({}));
    const pinned = !!body?.pinned;
    const target = typeof body?.user_id === 'string' ? body.user_id.trim() : '';

    const supabase = createAdminClient();
    const resident = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!resident) throw new ApiError('Not a resident of any estate', 403);

    let recipient = user.id;
    if (target && target !== user.id) {
      if (resident.role !== 'estate_admin') throw new ApiError('Admin access required', 403);
      if (!NOTIF_UUID_RE.test(target)) throw new ApiError('Invalid user ID', 400);
      recipient = target;
    }

    const updated = await patchOwnNotification(supabase, resident.estateId, recipient, id, { pinned });
    return NextResponse.json(updated);
  } catch (error) { return handleApiError(error, 'Failed to pin notification'); }
}

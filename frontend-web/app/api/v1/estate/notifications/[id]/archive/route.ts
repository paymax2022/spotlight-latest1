import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { NOTIF_UUID_RE, patchOwnNotification } from '@/src/server/estate/notifications';

// POST /api/v1/estate/notifications/[id]/archive {archived?} — move one of the caller's own notices
// between the inbox and the archive (EST-UAT-0359).
//
// Archiving is personal and reversible: it stamps archived_at on the recipient's copy and touches nobody
// else's. Un-archiving keeps read_at exactly as it was — pulling a notice back into the inbox is not the
// same act as making somebody forget they read it, and read_at is the date the sweep archives on.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await ctx.params;
    if (!NOTIF_UUID_RE.test(id)) throw new ApiError('Invalid notification ID', 400);

    const body: any = await request.json().catch(() => ({}));
    const archived = body?.archived === undefined ? true : !!body.archived;

    const supabase = createAdminClient();
    const resident = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!resident) throw new ApiError('Not a resident of any estate', 403);

    const updated = await patchOwnNotification(supabase, resident.estateId, user.id, id, {
      archived_at: archived ? new Date().toISOString() : null,
    });
    return NextResponse.json(updated);
  } catch (error) { return handleApiError(error, 'Failed to archive notification'); }
}

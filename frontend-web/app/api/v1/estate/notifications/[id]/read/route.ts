import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import {
  getOwnNotification, mapEstateNotification, NOTIF_UUID_RE, patchOwnNotification,
} from '@/src/server/estate/notifications';

// POST /api/v1/estate/notifications/[id]/read — stamp one of the caller's own notices read.
//
// The stamp is written once and never overwritten: read_at is the evidence that a recipient saw the
// notice, and the retention sweep keys archiving on it, so re-reading must not move the date.
//
// Order matters and is the point of the first two lines: a malformed id is a caller mistake (400) rather
// than a database 22P02 (500), and the estate write gate is answered before the row is looked up, so a
// suspended estate's member learns the estate is closed rather than that their notice is gone.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await ctx.params;
    if (!NOTIF_UUID_RE.test(id)) throw new ApiError('Invalid notification ID', 400);

    const supabase = createAdminClient();
    // forWrite: the BFF mirror of the Go LifecycleGate on /estate/:id — a pending, suspended or closed
    // estate takes no inbox mutation (ESTD-D025).
    const resident = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!resident) throw new ApiError('Not a resident of any estate', 403);

    const existing = await getOwnNotification(supabase, resident.estateId, user.id, id);
    if (existing.read_at) return NextResponse.json(mapEstateNotification(existing));

    const updated = await patchOwnNotification(supabase, resident.estateId, user.id, id, {
      read_at: new Date().toISOString(),
    });
    return NextResponse.json(updated);
  } catch (error) { return handleApiError(error, 'Failed to mark notification read'); }
}

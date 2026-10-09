import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { MEETING_COLUMNS, getResidentContext, mapMeeting } from '@/src/server/meetings/meetings.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// Upsert the caller's RSVP. Body: { response }.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(id)) throw new ApiError('Invalid meeting ID', 400);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const response = String(body?.response ?? '');
    if (!['yes', 'no', 'maybe'].includes(response)) throw new ApiError('Invalid RSVP response', 400);

    const { data: meeting } = await supabase
      .from('estate_meetings')
      .select('id, estate_id')
      .eq('id', id)
      .maybeSingle();
    if (!meeting || (meeting as any).estate_id !== ctx.estateId) throw new ApiError('Meeting not found', 404);

    const { error } = await supabase
      .from('meeting_rsvps')
      .upsert(
        { estate_id: ctx.estateId, meeting_id: id, user_id: user.id, response },
        { onConflict: 'meeting_id,user_id' },
      );
    if (error) throw error;

    const { data: row } = await supabase.from('estate_meetings').select(MEETING_COLUMNS).eq('id', id).single();
    return NextResponse.json(await mapMeeting(supabase, row, user.id));
  } catch (error) {
    return handleApiError(error, 'Failed to RSVP');
  }
}

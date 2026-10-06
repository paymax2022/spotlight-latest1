import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { MEETING_COLUMNS, getResidentContext, mapMeeting } from '@/src/server/meetings/meetings.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(id)) throw new ApiError('Invalid meeting ID', 400);

    const { data: row, error } = await supabase
      .from('estate_meetings')
      .select(MEETING_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Meeting not found', 404);

    return NextResponse.json(await mapMeeting(supabase, row, user.id));
  } catch (error) {
    return handleApiError(error, 'Failed to load meeting');
  }
}

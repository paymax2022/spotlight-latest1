import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minutes & decisions, or null.
// Residency gate mirrors GET /meetings/[id]: non-residents get a uniform 403 and
// foreign/unknown meetings both 404 so the route can't be used to enumerate
// meetings across estates. (Previously ungated — any authed user could read the
// minutes of ANY meeting by id.)
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(id)) throw new ApiError('Invalid meeting ID', 400);

    const { data: meeting, error: meetErr } = await supabase
      .from('estate_meetings')
      .select('id')
      .eq('id', id)
      .eq('estate_id', ctx.estateId)
      .maybeSingle();
    if (meetErr) throw meetErr;
    if (!meeting) throw new ApiError('Meeting not found', 404);

    const { data: row, error } = await supabase
      .from('meeting_minutes')
      .select('meeting_id, content, decisions, created_at')
      .eq('meeting_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json(null);

    return NextResponse.json({
      meetingId: (row as any).meeting_id,
      content: (row as any).content ?? '',
      decisions: Array.isArray((row as any).decisions) ? (row as any).decisions : [],
      updatedAt: (row as any).created_at,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load minutes');
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { MEETING_COLUMNS, getResidentContext, mapMeeting } from '@/src/server/meetings/meetings.service';

// GET /api/v1/estate/meetings — meetings for the caller's estate.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);

    const { data: rows, error } = await supabase
      .from('estate_meetings')
      .select(MEETING_COLUMNS)
      .eq('estate_id', ctx.estateId)
      .order('starts_at', { ascending: true });
    if (error) throw error;

    const result = await Promise.all((rows ?? []).map((r) => mapMeeting(supabase, r, user.id)));
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list meetings');
  }
}

// POST /api/v1/estate/meetings — schedule a meeting (auto-RSVPs the creator 'yes').
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    if (!title) throw new ApiError('Meeting title is required', 400);
    if (!body?.startsAt) throw new ApiError('Start time is required', 400);
    const mode = ['physical', 'virtual', 'hybrid'].includes(body?.mode) ? body.mode : 'physical';

    const { data: meeting, error } = await supabase
      .from('estate_meetings')
      .insert({
        estate_id: ctx.estateId,
        title,
        agenda: body?.agenda ? String(body.agenda).trim() : null,
        mode,
        location: body?.location ? String(body.location).trim() : null,
        starts_at: body.startsAt,
        ends_at: body?.endsAt ?? null,
        status: 'scheduled',
        created_by: user.id,
      })
      .select(MEETING_COLUMNS)
      .single();
    if (error) throw error;

    await supabase.from('meeting_rsvps').insert({
      estate_id: ctx.estateId, meeting_id: (meeting as any).id, user_id: user.id, response: 'yes',
    });

    return NextResponse.json(await mapMeeting(supabase, meeting, user.id), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create meeting');
  }
}

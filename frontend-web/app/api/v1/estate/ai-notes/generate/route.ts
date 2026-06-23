import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';
import { summariseMinutes } from '@/src/server/estate/ai-notes';
import { mapNote } from '../route';

const COLS = 'id, estate_id, meeting_id, title, summary, action_items, source, created_by, created_at';

// POST /api/v1/estate/ai-notes/generate — admin generates a summary from a
// meeting's recorded minutes using the deterministic extractive summariser.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can generate notes', 403);

    const body = await request.json();
    const meetingId = String(body?.meetingId ?? '');
    if (!meetingId) throw new ApiError('meetingId is required', 400);

    const { data: meeting, error: mErr } = await supabase.from('estate_meetings').select('id, estate_id, title').eq('id', meetingId).maybeSingle();
    if (mErr) throw mErr;
    if (!meeting || (meeting as any).estate_id !== ctx.estateId) throw new ApiError('Meeting not found', 404);

    // Concatenate all recorded minutes for the meeting.
    const { data: minutes, error: minErr } = await supabase.from('meeting_minutes').select('content, decisions').eq('meeting_id', meetingId).order('created_at', { ascending: true });
    if (minErr) throw minErr;
    if (!minutes || minutes.length === 0) throw new ApiError('No minutes have been recorded for this meeting yet', 409);

    const content = minutes.map((m: any) => m.content ?? '').join('\n\n');
    const decisions = minutes.flatMap((m: any) => (Array.isArray(m.decisions) ? m.decisions : []));
    const { summary, actionItems } = summariseMinutes(content, decisions);

    const { data: row, error } = await supabase.from('estate_ai_notes').insert({
      estate_id: ctx.estateId, meeting_id: meetingId, title: `Summary — ${(meeting as any).title}`,
      summary, action_items: actionItems, source: 'generated', created_by: user.id,
    }).select(COLS).single();
    if (error) throw error;

    const names = await resolveNames(supabase, [user.id]);
    return NextResponse.json(mapNote(row, names, (meeting as any).title), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to generate AI note'); }
}

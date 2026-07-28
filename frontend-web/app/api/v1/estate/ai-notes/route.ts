import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, meeting_id, title, summary, action_items, source, created_by, created_at';

export function mapNote(row: any, names: Record<string, string>, meetingTitle?: string) {
  return {
    id: row.id, estateId: row.estate_id, meetingId: row.meeting_id ?? undefined, meetingTitle,
    title: row.title, summary: row.summary,
    actionItems: Array.isArray(row.action_items) ? row.action_items : [],
    source: row.source, createdBy: row.created_by,
    createdByName: row.created_by ? names[row.created_by] ?? undefined : undefined, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/ai-notes
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_ai_notes').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
    if (error) throw error;
    const meetingIds = Array.from(new Set((rows ?? []).map((r: any) => r.meeting_id).filter(Boolean)));
    const titles: Record<string, string> = {};
    if (meetingIds.length) {
      const { data: ms } = await supabase.from('estate_meetings').select('id, title').in('id', meetingIds);
      (ms ?? []).forEach((m: any) => { titles[m.id] = m.title; });
    }
    const names = await resolveNames(supabase, (rows ?? []).map((r: any) => r.created_by));
    return NextResponse.json((rows ?? []).map((r) => mapNote(r, names, r.meeting_id ? titles[r.meeting_id] : undefined)));
  } catch (error) { return handleApiError(error, 'Failed to list AI notes'); }
}

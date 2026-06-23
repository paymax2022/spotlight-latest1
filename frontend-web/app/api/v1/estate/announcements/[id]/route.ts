import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, body, kind, created_by, created_at';

// GET /api/v1/estate/announcements/{id} — returns the notice and marks it read.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const { data: row, error } = await supabase.from('estate_announcements').select(COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Announcement not found', 404);
    await supabase.from('announcement_reads').upsert({ estate_id: ctx.estateId, announcement_id: id, user_id: user.id }, { onConflict: 'announcement_id,user_id' });
    const names = await resolveNames(supabase, [(row as any).created_by]);
    return NextResponse.json({ id: (row as any).id, estateId: (row as any).estate_id, title: (row as any).title, body: (row as any).body, kind: (row as any).kind, createdBy: (row as any).created_by, createdByName: names[(row as any).created_by] ?? 'Estate', createdAt: (row as any).created_at, read: true });
  } catch (error) { return handleApiError(error, 'Failed to load announcement'); }
}

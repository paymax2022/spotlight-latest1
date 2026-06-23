import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

// POST /api/v1/estate/announcements/{id}/read — mark read for the caller.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    await supabase.from('announcement_reads').upsert({ estate_id: ctx.estateId, announcement_id: id, user_id: user.id }, { onConflict: 'announcement_id,user_id' });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return handleApiError(error, 'Failed to mark read'); }
}

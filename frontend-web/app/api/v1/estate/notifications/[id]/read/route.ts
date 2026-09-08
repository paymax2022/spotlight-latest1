import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/v1/estate/notifications/[id]/read — mark one notification read.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { data: existing, error: getErr } = await supabase.from('estate_notifications').select('id, user_id, read_at').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).user_id !== user.id) throw new ApiError('Notification not found', 404);
    if (!(existing as any).read_at) {
      const { error } = await supabase.from('estate_notifications').update({ read_at: new Date().toISOString() }).eq('id', params.id);
      if (error) throw error;
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) { return handleApiError(error, 'Failed to mark notification read'); }
}

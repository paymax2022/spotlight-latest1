import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Remove a blacklist entry.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid blacklist entry ID', 400);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: existing } = await supabase
      .from('visitor_blacklist')
      .select('id')
      .eq('id', id)
      .eq('estate_id', ctx.estateId)
      .maybeSingle();
    if (!existing) throw new ApiError('Blacklist entry not found', 404);

    const { error } = await supabase
      .from('visitor_blacklist')
      .delete()
      .eq('id', id)
      .eq('estate_id', ctx.estateId);
    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to delete blacklist entry');
  }
}

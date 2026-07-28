import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, mapElection } from '@/src/server/elections/elections.service';

// GET /api/v1/elections/{id} — a single election (must belong to caller's estate).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: row, error } = await supabase
      .from('elections')
      .select('id, estate_id, title, description, starts_at, ends_at, status')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);

    return NextResponse.json(await mapElection(supabase, row));
  } catch (error) {
    return handleApiError(error, 'Failed to load election');
  }
}

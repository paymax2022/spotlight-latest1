import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, mapElection } from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// Publish results (estate admin, after close).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as a Postgres 22P02 → 500 for admins.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);
    const supabase = createAdminClient();

    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx || ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can publish results', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(id)) throw new ApiError('Invalid election ID', 400);

    const { data: election } = await supabase
      .from('elections')
      .select('id, estate_id, ends_at, status')
      .eq('id', id)
      .maybeSingle();
    if (!election || (election as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);
    if (Date.now() < Date.parse((election as any).ends_at)) {
      throw new ApiError('Results can only be published after the election closes', 409);
    }

    const { data: updated, error } = await supabase
      .from('elections')
      .update({ status: 'tallied' })
      .eq('id', id)
      .select('id, estate_id, title, description, starts_at, ends_at, status')
      .single();
    if (error) throw error;

    return NextResponse.json(await mapElection(supabase, updated));
  } catch (error) {
    return handleApiError(error, 'Failed to publish results');
  }
}

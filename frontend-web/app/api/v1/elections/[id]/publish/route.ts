import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { ELECTION_SELECT, getResidentContext, mapElection } from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Certification is a governance act, not a column write: the Go service is the only
// implementation of the gates (quorum met, no unresolved tie, no open complaint, at least
// one ballot for a candidate — EST-UAT-0223/0225/0227). Publishing therefore delegates to
// it, and fails closed when the governance API cannot be reached: a 504 is recoverable, a
// result published without those checks is not.
async function runGovernanceCall(
  request: Request,
  estateId: string,
  electionId: string,
  action: string,
): Promise<{ ok: boolean; status: number; message: string }> {
  const upstream = await proxyToGoBackend(
    request,
    `/api/finance/estate/${estateId}/elections/${electionId}/${action}`,
    { method: 'POST', body: {}, rateLimitKey: `election-${action}:${estateId}:${electionId}` },
  );
  if (upstream.ok) return { ok: true, status: upstream.status, message: '' };
  const payload = await upstream.json().catch(() => null) as { error?: string } | null;
  return {
    ok: false,
    status: upstream.status,
    message: payload?.error ?? `The election ${action} call was refused (${upstream.status})`,
  };
}

// Publish results (estate admin, after close).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as Postgres 22P02 → 500 for admins.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);
    const supabase = createAdminClient();

    const ctx = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!ctx || ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can publish results', 403);

    const { data: election } = await supabase
      .from('elections')
      .select('id, estate_id, ends_at, status')
      .eq('id', id)
      .maybeSingle();
    if (!election || (election as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);
    if (Date.now() < Date.parse((election as any).ends_at)) {
      throw new ApiError('Results can only be published after the election closes', 409);
    }
    if ((election as any).status === 'draft') {
      throw new ApiError('This election has not opened, so there is no result to publish', 409);
    }
    if ((election as any).status === 'cancelled') {
      throw new ApiError('This election was cancelled, so there is no result to publish', 409);
    }

    // A poll whose window has passed is still 'open' in the DB until it is closed; the
    // mobile one-button publish means "end the poll and certify what it decided", so walk
    // both lifecycle steps through the service that owns them.
    if ((election as any).status === 'open') {
      const closed = await runGovernanceCall(request, ctx.estateId, id, 'close');
      if (!closed.ok) throw new ApiError(closed.message, closed.status === 404 ? 404 : 409);
    }
    const certified = await runGovernanceCall(request, ctx.estateId, id, 'tally');
    if (!certified.ok) {
      if (certified.status === 504) throw new ApiError(certified.message, 504);
      throw new ApiError(certified.message, certified.status === 404 ? 404 : 409);
    }

    const { data: updated, error } = await supabase
      .from('elections')
      .select(ELECTION_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;

    return NextResponse.json(await mapElection(supabase, updated));
  } catch (error) {
    return handleApiError(error, 'Failed to publish results');
  }
}

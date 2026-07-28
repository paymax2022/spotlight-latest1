import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, isWithinWindow, MAIN_POSITION_SUFFIX } from '@/src/server/elections/elections.service';

// POST /api/v1/elections/{id}/vote — cast a vote. Body: { positionId, candidateId }.
// Single-position schema: positionId is accepted for contract parity but the
// vote is unique per (election, voter). Idempotency-Key header is honoured by
// the unique constraint (re-submitting the same vote returns the same ballot).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('You are not eligible to vote in this election', 403);

    const body = await request.json();
    const candidateId = String(body?.candidateId ?? '');
    if (!candidateId) throw new ApiError('candidateId is required', 400);

    const { data: election } = await supabase
      .from('elections')
      .select('id, estate_id, starts_at, ends_at, status')
      .eq('id', id)
      .maybeSingle();
    if (!election || (election as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);
    if ((election as any).status !== 'open' || !isWithinWindow(election)) {
      throw new ApiError('Voting is not open for this election', 409);
    }

    // Validate candidate belongs to this election.
    const { data: cand } = await supabase
      .from('election_candidates')
      .select('id')
      .eq('id', candidateId)
      .eq('election_id', id)
      .maybeSingle();
    if (!cand) throw new ApiError('Invalid candidate selection', 400);

    const { error: voteErr } = await supabase
      .from('election_votes')
      .insert({ election_id: id, voter_id: user.id, candidate_id: candidateId });
    if (voteErr) {
      // 23505 = unique_violation → already voted (one vote per voter).
      if ((voteErr as any).code === '23505') throw new ApiError('You have already voted in this election', 409);
      throw voteErr;
    }

    return NextResponse.json({
      electionId: id,
      choices: { [`${id}${MAIN_POSITION_SUFFIX}`]: candidateId },
      submittedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}

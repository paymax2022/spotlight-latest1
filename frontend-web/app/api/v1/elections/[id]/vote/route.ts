import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  MAIN_POSITION_SUFFIX,
  SEALED_BALLOT,
  checkVoteEligibility,
  getResidentContext,
  getVoterUnits,
  isWithinWindow,
} from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cast a vote. Body: { positionId, candidateId?, unitId?, abstain? }.
// Single-position schema: positionId is accepted for contract parity but the
// ballot is unique per (election, voter) — or per (election, unit) when the
// election counts one vote per unit (EST-UAT-0205). An absent candidateId (or
// abstain: true) is an abstention ballot: counted in turnout, credited to nobody
// (EST-UAT-0221). Idempotency-Key is honoured by the unique constraint, so
// re-submitting the same ballot returns the same refusal.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as a Postgres 22P02 → 500 for residents.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);
    const supabase = createAdminClient();

    const ctx = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!ctx) throw new ApiError('You are not eligible to vote in this election', 403);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const candidateId = String(body?.candidateId ?? '').trim();
    const abstain = body?.abstain === true || candidateId === '__abstain__';
    const unitId = String(body?.unitId ?? '').trim();
    if (candidateId && !abstain && !UUID_RE.test(candidateId)) throw new ApiError('Invalid candidate ID', 400);
    if (unitId && !UUID_RE.test(unitId)) throw new ApiError('Invalid unit ID', 400);
    if (!candidateId && !abstain) throw new ApiError('Choose a candidate or abstain', 400);

    const { data: election } = await supabase
      .from('elections')
      .select('id, estate_id, starts_at, ends_at, status, weighting')
      .eq('id', id)
      .maybeSingle();
    if (!election || (election as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);
    if ((election as any).status !== 'open' || !isWithinWindow(election)) {
      throw new ApiError('Voting is not open for this election', 409);
    }

    // Same gate the Go CastVote enforces: election_eligibility_rules
    // (KYC/dues/resident-type) + active dues restrictions + the frozen roll. Skipping it
    // let ineligible residents vote through the BFF while the Go API refused them.
    const elig = await checkVoteEligibility(supabase, ctx.estateId, user.id, id);
    if (!elig.eligible) {
      throw new ApiError(`You are not eligible to vote in this election (${elig.reasons.join(', ')})`, 403);
    }

    const weighted = (election as any).weighting === 'one_vote_per_unit';
    if (weighted && !unitId) throw new ApiError('This election counts one vote per unit — choose the unit this ballot is for', 400);
    if (!weighted && unitId) throw new ApiError('This election is one person, one vote — it has no per-unit ballots', 400);
    if (weighted) {
      const held = await getVoterUnits(supabase, ctx.estateId, user.id);
      if (!held.some((u) => u.id === unitId)) throw new ApiError('You do not hold this unit', 403);
    }

    if (candidateId && !abstain) {
      // election_candidates.id is uuid — same malformed-id → 22P02 guard.
      const { data: cand } = await supabase
        .from('election_candidates')
        .select('id')
        .eq('id', candidateId)
        .eq('election_id', id)
        .maybeSingle();
      if (!cand) throw new ApiError('Invalid candidate selection', 400);
    }

    // ESTB-D003: one write, two rows — the participation registry and the anonymous
    // ballot. election_votes no longer accepts a candidate, so the choice can never
    // be joined back to the voter. The database owns every other gate (window, frozen
    // roll, weighting, replay), so the state codes it raises are mapped below rather
    // than re-implemented here.
    const { error: voteErr } = await supabase.rpc('estate_cast_vote', {
      p_election_id: id,
      p_voter_id: user.id,
      p_candidate_id: candidateId && !abstain ? candidateId : null,
      p_unit_id: weighted ? unitId : null,
    });
    if (voteErr) {
      const code = (voteErr as any).code;
      // 23505 unique_violation → the ballot for this voter (or this unit) already exists.
      if (code === '23505') throw new ApiError('You have already voted in this election', 409);
      if (code === '23503') throw new ApiError('Invalid candidate selection', 400);
      // 42501 → the poll was cancelled, or the frozen roll no longer lists this voter.
      if (code === '42501') {
        throw new ApiError(
          /roll/i.test(voteErr.message ?? '')
            ? 'You are not on the published electoral roll for this election'
            : 'This election has been cancelled',
          403,
        );
      }
      if (code === '55000') throw new ApiError('Voting is not open for this election', 409);
      // 23514 check_violation → the ballot does not match how this election counts votes.
      if (code === '23514') throw new ApiError('This ballot does not match how this election counts votes', 400);
      throw voteErr;
    }

    const positionKey = unitId ? `${id}${MAIN_POSITION_SUFFIX}:${unitId}` : `${id}${MAIN_POSITION_SUFFIX}`;
    return NextResponse.json({
      electionId: id,
      // Participation is confirmed; the selection is sealed (secret ballot).
      choices: { [positionKey]: SEALED_BALLOT },
      abstained: abstain || !candidateId,
      submittedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}

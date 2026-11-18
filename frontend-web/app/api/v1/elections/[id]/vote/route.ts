import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  checkVoteEligibility,
  ELECTION_SELECT,
  getResidentContext,
  getVoterUnits,
  isWithinWindow,
  MAIN_POSITION_SUFFIX,
  SEALED_BALLOT,
} from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cast a vote. Body: { candidateId | abstain, unitId? } (positionId is accepted
// for contract parity; the single-position schema synthesises `${id}:main`).
//
// The write goes through estate_cast_vote, never a direct insert. Since
// 20271099000010 the choice and the identity live in different tables
// (election_ballots holds candidate_id, election_votes holds the participation
// registry with candidate_id nulled) so a voter→choice link cannot be stored in
// one row; and since 20271099000020 a one_vote_per_unit election legitimately
// has one participation row per unit the voter holds. Inserting into
// election_votes here would both re-break ballot secrecy (ESTB-D003) and drop
// the unit that authorises the ballot.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match a uuid column — reject before any query so a
    // malformed id doesn't surface as Postgres 22P02 → 500.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const abstain = body?.abstain === true;
    const candidateId = String(body?.candidateId ?? '').trim();
    const unitId = String(body?.unitId ?? '').trim();
    if (!abstain && !candidateId) {
      throw new ApiError('candidateId is required unless abstain is true', 400);
    }
    // An abstention is a ballot with no candidate (EST-UAT-0221), so the client
    // sends candidateId: '' alongside abstain: true.
    if (candidateId && !UUID_RE.test(candidateId)) throw new ApiError('Invalid candidate ID', 400);
    if (unitId && !UUID_RE.test(unitId)) throw new ApiError('Invalid unit ID', 400);

    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!ctx) throw new ApiError('You are not eligible to vote in this election', 403);

    const { data: election } = await supabase
      .from('elections')
      .select(ELECTION_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (!election || (election as any).estate_id !== ctx.estateId) throw new ApiError('Election not found', 404);
    if ((election as any).status !== 'open' || !isWithinWindow(election)) {
      throw new ApiError('Voting is not open for this election', 409);
    }

    // Same gate the Go CastVote enforces: election_eligibility_rules
    // (KYC/dues/resident-type) + active dues restrictions.
    const elig = await checkVoteEligibility(supabase, ctx.estateId, user.id, id);
    if (!elig.eligible) {
      throw new ApiError(`You are not eligible to vote in this election (${elig.reasons.join(', ')})`, 403);
    }

    // Weighting is checked before the write so the voter gets the reason, not a
    // database error code (EST-UAT-0205).
    const weighted = (election as any).weighting === 'one_vote_per_unit';
    if (weighted && !unitId) {
      throw new ApiError('This election counts one vote per unit held — choose the unit this ballot is cast on', 400);
    }
    if (!weighted && unitId) {
      throw new ApiError('This election is one person, one vote; its ballot is not cast on a unit', 400);
    }
    if (unitId) {
      const held = await getVoterUnits(supabase, ctx.estateId, user.id);
      if (!held.some((u) => u.id === unitId)) {
        throw new ApiError('You do not hold this unit, so you cannot cast its ballot', 403);
      }
    }

    if (candidateId) {
      const { data: cand } = await supabase
        .from('election_candidates')
        .select('id')
        .eq('id', candidateId)
        .eq('election_id', id)
        .maybeSingle();
      if (!cand) throw new ApiError('Invalid candidate selection', 400);
    }

    const { error: rpcErr } = await supabase.rpc('estate_cast_vote', {
      p_election_id: id,
      p_voter_id: user.id,
      p_candidate_id: candidateId || null,
      p_unit_id: unitId || null,
    });
    if (rpcErr) throw new ApiError(castVoteRefusal(rpcErr), refusalStatus(rpcErr.code));

    return NextResponse.json({
      electionId: id,
      abstained: !candidateId,
      // Participation is confirmed; the selection is sealed (secret ballot).
      choices: { [keyFor(id, unitId)]: SEALED_BALLOT },
      submittedAt: new Date().toISOString(),
      weighted,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}

function keyFor(electionId: string, unitId: string): string {
  const position = `${electionId}${MAIN_POSITION_SUFFIX}`;
  return unitId ? `${position}:${unitId}` : position;
}

// estate_cast_vote raises 23505 on replay, 23503 for a missing election or a
// foreign candidate, 42501 for a cancelled poll OR a voter dropped from the
// frozen roll, 55000 outside the window and 23514 for a weighting violation.
// 42501 carries two very different reasons, so the message decides which one the
// voter is told.
function castVoteRefusal(err: { code?: string; message?: string }): string {
  const message = String(err?.message ?? '');
  switch (err?.code) {
    case '23505':
      return 'You have already voted in this election';
    case '23503':
      return message.includes('candidate')
        ? 'Invalid candidate selection'
        : 'Election not found';
    case '42501':
      return /roll/i.test(message)
        ? 'You are not on the published electoral roll for this election'
        : 'This election has been cancelled';
    case '55000':
      return 'Voting is not open for this election';
    case '23514':
      return 'That ballot does not match how this election counts votes';
    default:
      return 'Failed to cast vote';
  }
}

function refusalStatus(code?: string): number {
  switch (code) {
    case '23505':
    case '55000':
      return 409;
    case '23503':
    case '23514':
      return 400;
    case '42501':
      return 403;
    default:
      return 500;
  }
}

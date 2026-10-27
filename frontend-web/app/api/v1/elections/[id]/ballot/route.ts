import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ELECTION_SELECT,
  MAIN_POSITION_SUFFIX,
  SEALED_BALLOT,
  getResidentContext,
  getVoterUnits,
} from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The caller's MyBallot for this election.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match elections.id — reject before the query so a
    // malformed id doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(id)) return errorResponse('Invalid election ID', 400);

    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    // Existence check scoped to the caller's estate (same gate as the sibling
    // [id] and vote routes) — otherwise this endpoint answered 200-empty for
    // ANY well-formed id, leaking which election ids exist.
    const { data: election, error: elErr } = await supabase
      .from('elections')
      .select(ELECTION_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (elErr) throw elErr;
    if (!election || (election as any).estate_id !== ctx.estateId) {
      throw new ApiError('Election not found', 404);
    }

    // Participation only — candidate_id is deliberately not selected. A
    // secret-ballot receipt must prove the vote was counted without revealing
    // the selection (EST-UAT-0216).
    //
    // Read as a LIST, not maybeSingle(): a one_vote_per_unit election authorises
    // several participation rows for the same voter (one per held unit,
    // EST-UAT-0205), and maybeSingle answers that with an error — which surfaced
    // as a 500 on the receipt screen for every weighted voter.
    const { data: castRows, error } = await supabase
      .from('election_votes')
      .select('id, cast_at, unit_id')
      .eq('election_id', id)
      .eq('voter_id', user.id);
    if (error) throw error;

    const ballots = (castRows ?? []) as { id: string; cast_at: string; unit_id: string | null }[];
    const weighted = (election as any).weighting === 'one_vote_per_unit';
    const units = weighted ? await getVoterUnits(supabase, ctx.estateId, user.id) : [];

    if (!ballots.length) {
      return NextResponse.json({
        electionId: id,
        choices: {},
        weighted,
        units: units.map((u) => ({ ...u, voted: false })),
        outstanding: weighted ? units.length : Math.max(0, 1 - ballots.length),
      });
    }

    // One sealed entry per ballot cast. Under weighting the key carries the unit,
    // because a receipt that proves "you voted" twice for the same position is
    // worth nothing unless it says which holding each ballot belongs to — the
    // unit is the voter's own property record, never a choice.
    const choices: Record<string, string> = {};
    for (const b of ballots) {
      const key = b.unit_id ? `${id}${MAIN_POSITION_SUFFIX}:${b.unit_id}` : `${id}${MAIN_POSITION_SUFFIX}`;
      choices[key] = SEALED_BALLOT;
    }
    const votedUnits = new Set(ballots.map((b) => b.unit_id).filter(Boolean) as string[]);

    return NextResponse.json({
      electionId: id,
      choices,
      submittedAt: ballots.reduce((latest, b) => (Date.parse(b.cast_at) > latest ? Date.parse(b.cast_at) : latest), 0),
      weighted,
      units: units.map((u) => ({ ...u, voted: votedUnits.has(u.id) })),
      outstanding: weighted ? units.length - votedUnits.size : 0,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load ballot');
  }
}

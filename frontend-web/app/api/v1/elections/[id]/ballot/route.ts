import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ELECTION_SELECT,
  getResidentContext,
  getVoterUnits,
  MAIN_POSITION_SUFFIX,
  SEALED_BALLOT,
} from '@/src/server/elections/elections.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The caller's MyBallot for this election: which ballots they have cast, never
// what they chose.
//
// Participation is read as a LIST, not a single row: a one_vote_per_unit
// election legitimately has one election_votes row per unit the voter holds
// (EST-UAT-0205), so a maybeSingle() there answered the receipt screen with an
// error for every weighted voter. Candidate_id is never selected — the choice
// lives in election_ballots precisely so no read can rejoin it to a voter
// (EST-UAT-0216).
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

    const { data: participation, error } = await supabase
      .from('election_votes')
      .select('id, cast_at, unit_id')
      .eq('election_id', id)
      .eq('voter_id', user.id);
    if (error) throw error;

    const rows = participation ?? [];
    const choices: Record<string, string> = {};
    for (const row of rows) {
      const unitId = (row as any).unit_id ? String((row as any).unit_id) : '';
      choices[unitId ? `${id}${MAIN_POSITION_SUFFIX}:${unitId}` : `${id}${MAIN_POSITION_SUFFIX}`] = SEALED_BALLOT;
    }

    const castTimes = rows.map((r: any) => Date.parse(r.cast_at)).filter((t) => !Number.isNaN(t));
    const submittedAt = castTimes.length ? Math.max(...castTimes) : undefined;

    const weighted = (election as any).weighting === 'one_vote_per_unit';
    if (!weighted) {
      return NextResponse.json({ electionId: id, choices, weighted: false, submittedAt });
    }

    // The voter's holdings turn the cast list into a receipt with a remainder:
    // which of their ballots are still outstanding.
    const held = await getVoterUnits(supabase, ctx.estateId, user.id);
    const units = held.map((u) => ({ id: u.id, label: u.label, voted: `${id}${MAIN_POSITION_SUFFIX}:${u.id}` in choices }));
    const outstanding = units.filter((u) => !u.voted).length;

    return NextResponse.json({ electionId: id, choices, weighted: true, units, outstanding, submittedAt });
  } catch (error) {
    return handleApiError(error, 'Failed to load ballot');
  }
}

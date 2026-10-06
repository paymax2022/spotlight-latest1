import { NextResponse } from 'next/server';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, MAIN_POSITION_SUFFIX } from '@/src/server/elections/elections.service';

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
      .select('id, estate_id')
      .eq('id', id)
      .maybeSingle();
    if (elErr) throw elErr;
    if (!election || (election as any).estate_id !== ctx.estateId) {
      throw new ApiError('Election not found', 404);
    }

    const { data: vote, error } = await supabase
      .from('election_votes')
      .select('candidate_id, cast_at')
      .eq('election_id', id)
      .eq('voter_id', user.id)
      .maybeSingle();
    if (error) throw error;

    if (!vote) return NextResponse.json({ electionId: id, choices: {} });

    return NextResponse.json({
      electionId: id,
      choices: { [`${id}${MAIN_POSITION_SUFFIX}`]: (vote as any).candidate_id },
      submittedAt: (vote as any).cast_at,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load ballot');
  }
}

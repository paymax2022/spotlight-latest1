import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { MAIN_POSITION_SUFFIX } from '@/src/server/elections/elections.service';

// GET /api/v1/elections/{id}/ballot — the caller's MyBallot for this election.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

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

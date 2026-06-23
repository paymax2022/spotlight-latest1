import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getVoteTotals } from '@/src/server/voting/totals.service';
import { getOrCreateShareLink } from '@/src/server/voting/share.service';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    if (!contestId) return errorResponse('contestId is required', 400);

    // Resolve contestant enrollment id for this user + contest
    const supabase = createAdminClient();
    const { data: enrollment } = await supabase
      .from('competition_enrollments')
      .select('id, stage_name')
      .eq('contest_id', contestId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!enrollment) return errorResponse('You are not enrolled in this contest', 403);

    const [totals, shareLink] = await Promise.all([
      getVoteTotals(contestId, (enrollment as any).id),
      getOrCreateShareLink(contestId, (enrollment as any).id, process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spotlightng.com'),
    ]);

    // Get rank context: how many votes to next rank
    const { data: aboveRows } = await supabase
      .from('vote_totals')
      .select('contestant_id, total_confirmed_votes')
      .eq('contest_id', contestId)
      .gt('total_confirmed_votes', totals?.totalConfirmedVotes ?? 0)
      .order('total_confirmed_votes', { ascending: false })
      .limit(1);

    const above = (aboveRows ?? [])[0] as any;
    const votesToNextRank = above
      ? Number(above.total_confirmed_votes) - (totals?.totalConfirmedVotes ?? 0) + 1
      : 0;

    return successResponse({
      success: true,
      contestId,
      contestantId: (enrollment as any).id,
      stageName: (enrollment as any).stage_name,
      totals,
      shareLink,
      votesToNextRank,
      currentRank: totals?.rank ?? null,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote summary');
  }
}

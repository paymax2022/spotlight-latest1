import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getVoteTotals } from '@/src/server/voting/totals.service';
import { getOrCreateShareLink } from '@/src/server/voting/share.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
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

    const [totals, shareLink, visibility] = await Promise.all([
      getVoteTotals(contestId, (enrollment as any).id),
      getOrCreateShareLink(contestId, (enrollment as any).id, process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com'),
      getEffectiveVisibility(contestId),
    ]);

    // VV-002: admin-configured visibility (public OR active-phase override)
    // also applies to a contestant's OWN self-view — hiding vote counts hides
    // them from everyone, contestant included, not just anonymous visitors.
    // This mirrors the D-004 gating pattern used by GET /api/vote-page.
    let votesToNextRank = 0;
    if (visibility.showVoteCount) {
      // Get rank context: how many votes to next rank. Only computed (and
      // only exposed) when counts are visible — the delta itself reveals a
      // vote quantity, so it must be gated the same as the raw counts.
      const { data: aboveRows } = await supabase
        .from('vote_totals')
        .select('contestant_id, total_confirmed_votes')
        .eq('contest_id', contestId)
        .gt('total_confirmed_votes', totals?.totalConfirmedVotes ?? 0)
        .order('total_confirmed_votes', { ascending: false })
        .limit(1);

      const above = (aboveRows ?? [])[0] as any;
      votesToNextRank = above
        ? Number(above.total_confirmed_votes) - (totals?.totalConfirmedVotes ?? 0) + 1
        : 0;
    }

    const safeTotals = totals
      ? {
          ...(visibility.showRank ? { rank: totals.rank } : {}),
          ...(visibility.showVoteCount
            ? {
                totalConfirmedVotes: totals.totalConfirmedVotes,
                freeVotes: totals.freeVotes,
                paidVotes: totals.paidVotes,
                bonusVotes: totals.bonusVotes,
                adminAdjustmentVotes: totals.adminAdjustmentVotes,
                reversedVotes: totals.reversedVotes,
                quarantinedVotes: totals.quarantinedVotes,
              }
            : {}),
        }
      : null;
    const totalsOut = safeTotals && Object.keys(safeTotals).length > 0 ? safeTotals : null;

    return successResponse({
      success: true,
      contestId,
      contestantId: (enrollment as any).id,
      stageName: (enrollment as any).stage_name,
      totals: totalsOut,
      shareLink,
      votesToNextRank,
      currentRank: visibility.showRank ? (totals?.rank ?? null) : null,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote summary');
  }
}

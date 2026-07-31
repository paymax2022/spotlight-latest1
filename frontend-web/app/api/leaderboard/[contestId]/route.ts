import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getLeaderboard } from '@/src/server/voting/totals.service';
import { getVotingSettings } from '@/src/server/voting/free-vote.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const { contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const roundId = searchParams.get('roundId') ?? undefined;
    const limit = Math.min(500, Number(searchParams.get('limit') ?? 50));

    const settings = await getVotingSettings(contestId);
    // D-005: gate on the PHASE-AWARE effective visibility, not raw contest flags.
    // A phase can hide the leaderboard / counts / rank even when the contest-level
    // flags are permissive (and vice versa).
    const visibility = await getEffectiveVisibility(contestId);

    // Redact hidden counts / rank from any leaderboard payload — live OR snapshot,
    // so a frozen cache can never leak what live reads hide (VV-007).
    const redact = (entries: unknown[]): unknown[] =>
      (entries ?? []).map((entry) => {
        const out: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
        if (!visibility.showVoteCount) {
          delete out.totalConfirmedVotes;
          delete out.freeVotes;
          delete out.paidVotes;
        }
        if (!visibility.showRank) delete out.rank;
        return out;
      });

    if (!visibility.showLeaderboard) {
      return errorResponse('Leaderboard is not public for this contest', 403);
    }

    // Handle leaderboard freeze
    if (
      settings.leaderboardFreezeEnabled &&
      settings.leaderboardFreezeAt &&
      Date.now() >= Date.parse(settings.leaderboardFreezeAt)
    ) {
      // Return last frozen snapshot instead of live totals
      const supabase = createAdminClient();
      const { data: snapshot } = await supabase
        .from('leaderboard_snapshots')
        .select('snapshot_data, snapshot_at')
        .eq('contest_id', contestId)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapshot) {
        return successResponse({
          contestId,
          frozen: true,
          frozenAt: snapshot.snapshot_at,
          showVoteCount: visibility.showVoteCount,
          showRank: visibility.showRank,
          leaderboard: redact((snapshot.snapshot_data as unknown[]) ?? []),
        });
      }
    }

    const leaderboard = await getLeaderboard(contestId, roundId, limit);

    // Enrich with contestant names from competition_enrollments
    const supabase = createAdminClient();
    const contestantIds = leaderboard.map((e) => e.contestantId);

    if (contestantIds.length > 0) {
      const { data: contestants } = await supabase
        .from('competition_enrollments')
        .select('id, user_id, stage_name, profiles:user_profiles(full_name, avatar_url, state)')
        .in('id', contestantIds);

      const byId = new Map((contestants ?? []).map((c: any) => [c.id, c]));

      for (const entry of leaderboard) {
        const c = byId.get(entry.contestantId) as any;
        if (c) {
          entry.contestantName = c.profiles?.full_name ?? c.stage_name ?? 'Contestant';
          entry.stageName = c.stage_name ?? null;
          entry.photoUrl = c.profiles?.avatar_url ?? null;
          entry.state = c.profiles?.state ?? null;
        }
      }
    }

    return successResponse({
      contestId,
      frozen: false,
      showVoteCount: visibility.showVoteCount,
      showRank: visibility.showRank,
      leaderboard: redact(leaderboard),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load leaderboard');
  }
}

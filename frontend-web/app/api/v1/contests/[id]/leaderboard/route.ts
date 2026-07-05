import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { getLeaderboard } from '@/src/server/voting/totals.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Compute rankChange direction.
 * - currentRank < previousRank means the contestant moved up (lower rank number = better position).
 * - Returns 'same' when previousRank is unavailable, so we degrade gracefully until historical
 *   rank data is present in the DB (e.g. a `previous_rank` column on vote_totals).
 */
function computeRankChange(
  currentRank: number,
  previousRank: number | null | undefined,
): 'up' | 'down' | 'same' {
  if (previousRank == null) return 'same';
  if (currentRank < previousRank) return 'up';
  if (currentRank > previousRank) return 'down';
  return 'same';
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    const supabase = createAdminClient();

    // Respect admin visibility: when the leaderboard is hidden for the contest
    // (or the active phase), return an explicit hidden marker instead of ranks.
    const vis = await getEffectiveVisibility(contestId);
    if (!vis.showLeaderboard) {
      return NextResponse.json({
        hidden: true,
        reason: vis.activePhaseLabel
          ? `The leaderboard is hidden during ${vis.activePhaseLabel}.`
          : 'The leaderboard is currently hidden for this contest.',
        entries: [],
      });
    }

    const entries = await getLeaderboard(contestId);

    // Enrich with contestant names
    const ids = entries.map((e) => e.contestantId);
    if (ids.length > 0) {
      const { data: rows } = await supabase
        .from('competition_enrollments')
        .select('id, stage_name, profile_photo_url, genre_style, user_profiles(full_name, avatar_url)')
        .in('id', ids);

      const byId = new Map((rows ?? []).map((r: any) => [r.id, r]));
      for (const e of entries) {
        const r = byId.get(e.contestantId) as any;
        if (r) {
          e.contestantName = r.user_profiles?.full_name ?? r.stage_name ?? 'Contestant';
          e.stageName = r.stage_name ?? null;
          e.photoUrl = r.profile_photo_url || r.user_profiles?.avatar_url || null;
        }
      }
    }

    // Attempt to read previous_rank from a snapshot table if it exists.
    // The query is best-effort: if the table/column doesn't exist we fall back to null (=> 'same').
    const previousRankMap = new Map<string, number | null>();
    try {
      const { data: snapRows } = await supabase
        .from('vote_totals_rank_snapshots')
        .select('contestant_id, previous_rank')
        .eq('contest_id', contestId);
      if (snapRows) {
        for (const row of snapRows as Array<{ contestant_id: string; previous_rank: number | null }>) {
          previousRankMap.set(row.contestant_id, row.previous_rank ?? null);
        }
      }
    } catch {
      // Snapshot table not yet available -- rankChange degrades to 'same'.
    }

    // Map to the shape the mobile LeaderboardEntry expects
    const result = entries.map((e, i) => {
      const currentRank = i + 1; // position in the live sorted result (ordered by total_confirmed_votes desc)

      // Prefer snapshot data; fall back to the stored rank column as "previous rank"
      // (the stored rank was set by the last recomputeRanks call, so it trails live vote order).
      const snapshotPreviousRank = previousRankMap.get(e.contestantId) ?? null;
      const storedRank = e.rank != null ? e.rank : null;
      const previousRank = snapshotPreviousRank ?? storedRank;

      return {
        rank: currentRank,
        contestant: {
          id: e.contestantId,
          name: e.contestantName ?? 'Contestant',
          category: null,
          photoUrl: (e as any).photoUrl ?? null,
          rank: currentRank,
          voteCount: vis.showVoteCount ? e.totalConfirmedVotes : null,
          votePercent: 0, // not needed for leaderboard display
          isTopContestant: currentRank <= 3,
        },
        rankChange: computeRankChange(currentRank, previousRank),
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to load leaderboard');
  }
}

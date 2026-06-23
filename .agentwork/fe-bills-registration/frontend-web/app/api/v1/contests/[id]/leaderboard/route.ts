import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { getLeaderboard } from '@/src/server/voting/totals.service';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    const supabase = createAdminClient();

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

    // Map to the shape the mobile LeaderboardEntry expects
    const result = entries.map((e, i) => ({
      rank: e.rank ?? i + 1,
      contestant: {
        id: e.contestantId,
        name: e.contestantName ?? 'Contestant',
        category: null,
        photoUrl: (e as any).photoUrl ?? null,
        rank: e.rank ?? i + 1,
        voteCount: e.totalConfirmedVotes,
        votePercent: 0, // not needed for leaderboard display
        isTopContestant: (e.rank ?? i + 1) <= 3,
      },
      rankChange: 'same' as const,
    }));

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to load leaderboard');
  }
}

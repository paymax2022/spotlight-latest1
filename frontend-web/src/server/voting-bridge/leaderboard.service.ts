import { createAdminClient } from '@/lib/supabase/server';
import type { LeaderboardEntry } from '@/src/features/voting/types';

/**
 * E2E-X-026 bridge fix — leaderboard permanently empty.
 *
 * totals.service.ts#getLeaderboard embeds `contestant_share_links ( share_code,
 * share_url )` on `vote_totals` — but there is no foreign key between the two
 * tables, so PostgREST answers PGRST200 and the service's
 * `if (error || !data) return []` swallows it: admin and public leaderboards
 * rendered [] even with confirmed votes present.
 *
 * totals.service.ts is hook-protected (`.claude/hooks/protect-legacy.sh` — wrap,
 * never edit), so the fix lives here in the bridge layer, mirroring
 * leaderboard-ranks.ts: same query MINUS the invalid embed, then a second query
 * against `contestant_share_links` (UNIQUE per (contest_id, contestant_id))
 * merged by contestant_id. Return shape is identical to the legacy service's —
 * callers need no other change.
 */
export async function getLeaderboard(
  contestId: string,
  roundId?: string,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('vote_totals')
    .select(`
      contestant_id,
      free_votes,
      paid_votes,
      bonus_votes,
      admin_adjustment_votes,
      reversed_votes,
      total_confirmed_votes,
      rank,
      last_vote_at
    `)
    .eq('contest_id', contestId)
    .is('round_id', roundId ?? null)
    .order('total_confirmed_votes', { ascending: false })
    .order('last_vote_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error || !data) return [];

  // Share links have no FK to vote_totals — fetch them per contest+contestant
  // in a second query instead of the (broken) embed. Failure is non-fatal:
  // share fields degrade to null, the votes still render.
  const contestantIds = data
    .map((row: any) => row.contestant_id as string)
    .filter(Boolean);
  const shareByContestant = new Map<string, { share_code: string | null; share_url: string | null }>();
  if (contestantIds.length > 0) {
    const { data: links } = await supabase
      .from('contestant_share_links')
      .select('contestant_id, share_code, share_url')
      .eq('contest_id', contestId)
      .in('contestant_id', contestantIds);
    for (const link of links ?? []) {
      shareByContestant.set(link.contestant_id as string, {
        share_code: (link.share_code as string | null) ?? null,
        share_url: (link.share_url as string | null) ?? null,
      });
    }
  }

  return data.map((row: any, idx: number) => ({
    rank: row.rank ?? idx + 1,
    contestantId: row.contestant_id,
    contestantName: '',      // joined in the API layer from contestants/submissions
    stageName: null,
    photoUrl: null,
    category: null,
    state: null,
    totalConfirmedVotes: Number(row.total_confirmed_votes),
    freeVotes: Number(row.free_votes),
    paidVotes: Number(row.paid_votes),
    lastVoteAt: row.last_vote_at,
    shareCode: shareByContestant.get(row.contestant_id)?.share_code ?? null,
    shareUrl: shareByContestant.get(row.contestant_id)?.share_url ?? null,
  }));
}

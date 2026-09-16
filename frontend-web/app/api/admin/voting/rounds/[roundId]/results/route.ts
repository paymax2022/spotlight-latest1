import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { TIE_BREAK_RULE } from '../_shared';

type RouteContext = { params: Promise<{ roundId: string }> };

// GET /api/admin/voting/rounds/[roundId]/results
// Read-only: returns already-published results without re-publishing. Lets
// the admin UI show a locked round's leaderboard on load, instead of having
// to call publish-results (which would 409 on an already-published round
// anyway, and must never be called speculatively just to "peek").
export async function GET(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { roundId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: rows, error } = await supabase
      .from('voting_round_results')
      .select('contestant_id, rank, total_confirmed_votes, paid_votes, prize_id')
      .eq('round_id', roundId)
      .order('rank', { ascending: true });

    if (error) return errorResponse(`Failed to load results: ${error.message}`, 500);

    if (!rows || rows.length === 0) {
      return successResponse({ success: true, results: [], published: false });
    }

    const prizeIds = Array.from(new Set(rows.map((r: any) => r.prize_id).filter(Boolean)));
    const prizeIdToDescription = new Map<string, string>();
    if (prizeIds.length > 0) {
      const { data: prizeRows } = await supabase
        .from('contest_prizes')
        .select('id, prize_description')
        .in('id', prizeIds);
      for (const row of prizeRows ?? []) {
        prizeIdToDescription.set((row as any).id, (row as any).prize_description);
      }
    }

    const results = rows.map((row: any) => ({
      contestantId: row.contestant_id,
      rank: row.rank,
      totalConfirmedVotes: Number(row.total_confirmed_votes),
      paidVotes: Number(row.paid_votes),
      prizeId: row.prize_id ?? null,
      prizeDescription: row.prize_id ? prizeIdToDescription.get(row.prize_id) ?? null : null,
    }));

    return successResponse({
      success: true,
      results,
      published: true,
      tieBreakRule: TIE_BREAK_RULE,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load voting round results');
  }
}

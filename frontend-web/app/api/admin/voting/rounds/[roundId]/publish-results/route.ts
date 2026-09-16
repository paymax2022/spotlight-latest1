import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { bridgedRecomputeRanksForResults } from '@/src/server/voting-bridge/leaderboard-ranks';
import { TIE_BREAK_RULE } from '../_shared';

type RouteContext = { params: Promise<{ roundId: string }> };

// POST /api/admin/voting/rounds/[roundId]/publish-results
//
// AD-011/VI-010: compute -> publish -> lock, in one action, with the correct
// (bridge-owned) tie-break and immutability enforced server-side.
//
// voting_rounds.contest_id is a FK to the LEGACY public.contests table, not
// connect_contests (see 20260602100000_universal_voting_engine.sql:383-411).
// contest_prizes keys off connect_contests, per the same convention as
// contest_templates.connect_contest_id (20270212000000). The two tables share
// the same row id for any contest reachable here — legacy->connect and
// connect->legacy both preserve `id` when mirroring
// (20261223000000_connect_contests_bridge.sql, 20270129000000_mirror_connect_contests_to_legacy.sql)
// — so round.contest_id is used directly as connect_contest_id below; no
// separate resolver step is needed (see 20270213000000 migration header for
// the full note).
//
// Insert-results + status-flip are done together via the
// publish_voting_round_results() Postgres function (added in the same
// migration) so they cannot partially succeed across two separate Supabase
// calls — see that migration's comment for why a single RPC was chosen here.
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { roundId } = await ctx.params;

    const supabase = createAdminClient();

    const { data: round, error: roundError } = await supabase
      .from('voting_rounds')
      .select('id, contest_id, status, name')
      .eq('id', roundId)
      .maybeSingle();

    if (roundError) return errorResponse(`Failed to load round: ${roundError.message}`, 500);
    if (!round) return errorResponse('Voting round not found', 404);

    if ((round as any).status === 'results_published') {
      return errorResponse(
        'Results already published and locked for this round — publishing is a one-time, immutable action.',
        409,
      );
    }

    const contestId = (round as any).contest_id as string;

    const ranks = await bridgedRecomputeRanksForResults(contestId, roundId);
    if (ranks.length === 0) {
      return errorResponse('No leaderboard data to publish for this round', 400);
    }

    // contest_prizes keys off connect_contest_id, which shares round.contest_id's
    // value here — see the module header note above.
    const { data: prizeRows, error: prizesError } = await supabase
      .from('voting_contest_prizes')
      .select('id, position')
      .eq('connect_contest_id', contestId);

    if (prizesError) return errorResponse(`Failed to load contest prizes: ${prizesError.message}`, 500);

    const prizeByPosition = new Map<number, string>();
    for (const row of prizeRows ?? []) {
      prizeByPosition.set((row as any).position, (row as any).id);
    }

    const resultsPayload = ranks.map((entry) => ({
      contestant_id: entry.contestantId,
      rank: entry.rank,
      total_confirmed_votes: entry.totalConfirmedVotes,
      paid_votes: entry.paidVotes,
      prize_id: prizeByPosition.get(entry.rank) ?? null,
    }));

    const { data: insertedRows, error: publishError } = await supabase.rpc('publish_voting_round_results', {
      p_round_id: roundId,
      p_results: resultsPayload,
      p_published_by: identity.actorId || null,
    });

    if (publishError) {
      if ((publishError as any).message?.includes('voting_round_already_published')) {
        return errorResponse(
          'Results already published and locked for this round — publishing is a one-time, immutable action.',
          409,
        );
      }
      if ((publishError as any).message?.includes('voting_round_not_found')) {
        return errorResponse('Voting round not found', 404);
      }
      return errorResponse(`Failed to publish results: ${(publishError as any).message}`, 500);
    }

    const resultRows = (insertedRows ?? []) as any[];
    const prizeIdToDescription = new Map<string, string>();
    if (prizeRows && prizeRows.length > 0) {
      const { data: fullPrizeRows } = await supabase
        .from('voting_contest_prizes')
        .select('id, prize_description')
        .eq('connect_contest_id', contestId);
      for (const row of fullPrizeRows ?? []) {
        prizeIdToDescription.set((row as any).id, (row as any).prize_description);
      }
    }

    const contestantIds = Array.from(new Set(resultRows.map((r) => r.contestant_id).filter(Boolean)));
    const contestantIdToName = new Map<string, string>();
    if (contestantIds.length > 0) {
      const { data: contestantRows } = await supabase
        .from('contestants')
        .select('id, name')
        .in('id', contestantIds);
      for (const row of contestantRows ?? []) {
        contestantIdToName.set((row as any).id, (row as any).name);
      }
    }

    const results = resultRows
      .map((row) => ({
        contestantId: row.contestant_id,
        contestantName: contestantIdToName.get(row.contestant_id) ?? null,
        rank: row.rank,
        totalConfirmedVotes: Number(row.total_confirmed_votes),
        paidVotes: Number(row.paid_votes),
        prizeId: row.prize_id ?? null,
        prizeDescription: row.prize_id ? prizeIdToDescription.get(row.prize_id) ?? null : null,
      }))
      .sort((a, b) => a.rank - b.rank);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'voting_round_results_locked',
      entityType: 'voting_round',
      entityId: roundId,
      contestId,
      newValue: {
        contestantCount: results.length,
        topContestantId: results[0]?.contestantId ?? null,
        tieBreakRule: TIE_BREAK_RULE,
      },
    });

    return successResponse({
      success: true,
      results,
      published: true,
      tieBreakRule: TIE_BREAK_RULE,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to publish voting round results');
  }
}

import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    // Non-UUID ids can never match contestants.contest_id — reject before the
    // query so a malformed id doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(contestId)) {
      return errorResponse('Invalid contest ID', 400);
    }
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? undefined;

    const supabase = createAdminClient();

    let query = supabase
      .from('contestants')
      .select(`
        id,
        name,
        stage_name,
        category,
        state,
        photo_url,
        status
      `)
      .eq('contest_id', contestId)
      .in('status', ['approved', 'active']);

    if (search) {
      // E2E-SEC-060: strip PostgREST filter-grammar metacharacters before
      // interpolating into .or() — unescaped commas/parens let a caller
      // reshape the filter (e.g. append ",other_col.eq.x").
      const term = search.replace(/[(),."\\]/g, '').slice(0, 80);
      if (term) {
        query = query.or(`stage_name.ilike.%${term}%,category.ilike.%${term}%`);
      }
    }

    const { data: enrollments, error } = await query;
    if (error) throw error;

    if (!enrollments?.length) return NextResponse.json([]);

    const ids = enrollments.map((e: any) => e.id);

    const [{ data: totalsRows }, visibility] = await Promise.all([
      supabase
        .from('vote_totals')
        .select('contestant_id, total_confirmed_votes, rank')
        .eq('contest_id', contestId)
        .in('contestant_id', ids),
      // Phase-aware effective visibility (D-004/VV-007 convention) — the same
      // gate the contestant DETAIL route applies: a phase can hide counts/rank
      // even when the contest-level flags are permissive.
      getEffectiveVisibility(contestId),
    ]);

    const totalsById = new Map((totalsRows ?? []).map((t: any) => [t.contestant_id, t]));
    const grandTotal = (totalsRows ?? []).reduce(
      (sum: number, t: any) => sum + (t.total_confirmed_votes ?? 0),
      0,
    );

    const result = enrollments
      .map((e: any, idx: number) => {
        const totals = totalsById.get(e.id) as any;
        const voteCount = totals?.total_confirmed_votes ?? 0;
        const rank = totals?.rank ?? idx + 1;
        return {
          body: {
            id: e.id,
            name: e.name ?? e.stage_name ?? 'Contestant',
            stageName: e.stage_name || null,
            category: e.category || null,
            state: e.state || null,
            photoUrl: e.photo_url || null,
            // Never leak hidden vote counts / rank through this public list —
            // the same redaction the sibling detail route applies. Fields are
            // omitted, not nulled, so a caller can't distinguish "hidden" from
            // "zero". (List order follows the leaderboard convention: rows stay
            // vote-ordered even when the counts themselves are hidden.)
            ...(visibility.showRank
              ? { rank, isTopContestant: rank <= 3 }
              : {}),
            ...(visibility.showVoteCount
              ? {
                  voteCount,
                  votePercent:
                    grandTotal > 0 ? Math.round((voteCount / grandTotal) * 1000) / 10 : 0,
                }
              : {}),
          },
          sortKey: voteCount,
        };
      })
      .sort((a: any, b: any) => b.sortKey - a.sortKey)
      .map((r: any) => r.body);

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list contestants');
  }
}

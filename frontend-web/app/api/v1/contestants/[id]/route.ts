import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestantId } = await context.params;
    const supabase = createAdminClient();

    // Read the contestant from the `contestants` roster — the table
    // votes.contestant_id / vote_totals.contestant_id reference
    // (competition_enrollments is a separate, empty enrollment table).
    const { data: enrollment, error } = await supabase
      .from('contestants')
      .select(`
        id,
        contest_id,
        name,
        stage_name,
        bio,
        photo_url,
        category,
        state,
        media_url,
        status,
        voting_link_slug,
        total_votes,
        ranking
      `)
      .eq('id', contestantId)
      .maybeSingle();

    if (error) throw error;
    if (!enrollment) return errorResponse('Contestant not found', 404);

    const contestId = (enrollment as any).contest_id;

    const [{ data: totals }, { data: contestTotals }] = await Promise.all([
      supabase
        .from('vote_totals')
        .select('total_confirmed_votes, free_votes, paid_votes, rank')
        .eq('contestant_id', contestantId)
        .eq('contest_id', contestId)
        .maybeSingle(),
      supabase
        .from('vote_totals')
        .select('total_confirmed_votes')
        .eq('contest_id', contestId),
    ]);

    const grandTotal = (contestTotals ?? []).reduce(
      (sum: number, t: any) => sum + (t.total_confirmed_votes ?? 0),
      0,
    );
    const voteCount = (totals as any)?.total_confirmed_votes ?? 0;
    const rank = (totals as any)?.rank ?? null;

    return NextResponse.json({
      id: enrollment.id,
      contestId,
      name: (enrollment as any).name ?? (enrollment as any).stage_name ?? 'Contestant',
      stageName: (enrollment as any).stage_name || null,
      category: (enrollment as any).category || null,
      state: (enrollment as any).state || null,
      photoUrl: (enrollment as any).photo_url || null,
      bio: (enrollment as any).bio || null,
      socialLinks: {},
      rank,
      voteCount,
      votePercent: grandTotal > 0 ? Math.round((voteCount / grandTotal) * 1000) / 10 : 0,
      isTopContestant: rank !== null && rank <= 3,
      highlights: [],
      recentVotes: (totals as any)?.free_votes ?? 0,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load contestant');
  }
}

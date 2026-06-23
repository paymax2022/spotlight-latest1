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

    const { data: enrollment, error } = await supabase
      .from('competition_enrollments')
      .select(`
        id,
        competition_id,
        stage_name,
        genre_style,
        state,
        profile_photo_url,
        short_bio,
        social_links,
        user_profiles ( full_name, avatar_url )
      `)
      .eq('id', contestantId)
      .maybeSingle();

    if (error) throw error;
    if (!enrollment) return errorResponse('Contestant not found', 404);

    const profile = (enrollment as any).user_profiles ?? {};
    const contestId = (enrollment as any).competition_id;

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
      name: profile.full_name ?? (enrollment as any).stage_name ?? 'Contestant',
      stageName: (enrollment as any).stage_name || null,
      category: (enrollment as any).genre_style || null,
      state: (enrollment as any).state || null,
      photoUrl: (enrollment as any).profile_photo_url || profile.avatar_url || null,
      bio: (enrollment as any).short_bio || null,
      socialLinks: (enrollment as any).social_links ?? {},
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

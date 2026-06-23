import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? undefined;

    const supabase = createAdminClient();

    let query = supabase
      .from('competition_enrollments')
      .select(`
        id,
        stage_name,
        genre_style,
        state,
        profile_photo_url,
        status,
        user_profiles ( full_name, avatar_url )
      `)
      .eq('competition_id', contestId)
      .eq('status', 'enrolled');

    if (search) {
      query = query.or(`stage_name.ilike.%${search}%,genre_style.ilike.%${search}%`);
    }

    const { data: enrollments, error } = await query;
    if (error) throw error;

    if (!enrollments?.length) return NextResponse.json([]);

    const ids = enrollments.map((e: any) => e.id);

    const { data: totalsRows } = await supabase
      .from('vote_totals')
      .select('contestant_id, total_confirmed_votes, rank')
      .eq('contest_id', contestId)
      .in('contestant_id', ids);

    const totalsById = new Map((totalsRows ?? []).map((t: any) => [t.contestant_id, t]));
    const grandTotal = (totalsRows ?? []).reduce(
      (sum: number, t: any) => sum + (t.total_confirmed_votes ?? 0),
      0,
    );

    const result = enrollments
      .map((e: any, idx: number) => {
        const profile = e.user_profiles ?? {};
        const totals = totalsById.get(e.id) as any;
        const voteCount = totals?.total_confirmed_votes ?? 0;
        const rank = totals?.rank ?? idx + 1;
        return {
          id: e.id,
          name: profile.full_name ?? e.stage_name ?? 'Contestant',
          stageName: e.stage_name || null,
          category: e.genre_style || null,
          state: e.state || null,
          photoUrl: e.profile_photo_url || profile.avatar_url || null,
          rank,
          voteCount,
          votePercent: grandTotal > 0 ? Math.round((voteCount / grandTotal) * 1000) / 10 : 0,
          isTopContestant: rank <= 3,
        };
      })
      .sort((a: any, b: any) => b.voteCount - a.voteCount);

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list contestants');
  }
}

import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { getRemainingFreeVotes } from '@/src/server/voting/free-vote.service';
import { getEffectiveVisibility } from '@/src/server/voting/visibility.service';

function getIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

async function tryGetUserId(request: Request): Promise<string | undefined> {
  try {
    const token = (request.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return undefined;
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser(token);
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = createAdminClient();

    const { data: contest, error } = await supabase
      .from('contests')
      .select('id, name, description, rules, prize_pool, category, status, start_date, end_date, max_contestants')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!contest) return errorResponse('Contest not found', 404);

    const { data: settings } = await supabase
      .from('voting_settings')
      .select('voting_enabled, voting_ends_at, free_votes_per_day, free_voting_enabled')
      .eq('contest_id', id)
      .eq('status', 'active')
      .maybeSingle();

    const { data: totals } = await supabase
      .from('vote_totals')
      .select('total_confirmed_votes')
      .eq('contest_id', id);

    const totalVotes = (totals ?? []).reduce((s: number, t: any) => s + (t.total_confirmed_votes ?? 0), 0);

    let freeVotesRemaining = settings?.free_votes_per_day ?? 0;
    try {
      const ip = getIp(request);
      const userId = await tryGetUserId(request);
      const remaining = await getRemainingFreeVotes(id, { userId, ipAddress: ip });
      freeVotesRemaining = remaining.freeVotesRemaining;
    } catch {}

    const endsAt = (settings as any)?.voting_ends_at ?? (contest as any).end_date;
    const now = Date.now();
    const isLive = !!(settings?.voting_enabled && endsAt && Date.parse(endsAt) > now);

    // Effective visibility (per-phase override else contest-level). When vote
    // count is hidden, do not leak the aggregate total; when the leaderboard is
    // hidden, the client hides the leaderboard surface.
    const vis = await getEffectiveVisibility(id);

    return successResponse({
      id: contest.id,
      title: contest.name,
      description: contest.description,
      rules: contest.rules,
      prizePool: contest.prize_pool,
      category: contest.category ?? 'General',
      contestantCount: (totals ?? []).length,
      totalVotes: vis.showVoteCount ? totalVotes : null,
      endsAt: endsAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      isLive,
      isTrending: vis.showVoteCount ? totalVotes > 10_000 : false,
      votingEnabled: settings?.voting_enabled ?? false,
      freeVotingEnabled: settings?.free_voting_enabled ?? false,
      freeVotesRemaining,
      userVoteCount: 0,
      // Visibility controls (respected by the app).
      showVoteCount: vis.showVoteCount,
      showLeaderboard: vis.showLeaderboard,
      showRank: vis.showRank,
      activePhaseKey: vis.activePhaseKey,
      activePhaseLabel: vis.activePhaseLabel,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest');
  }
}

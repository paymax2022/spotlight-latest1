import { getAdminServiceContext } from './context';
import { logger } from '@/lib/logger';

export async function fetchLeaderboard(competitionId: string, limit = 100) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_entries')
    .select(
      'id, competition_id, entry_title, category, status, judge_score, public_vote_count, leaderboard_score'
    )
    .eq('competition_id', competitionId)
    .in('status', ['live_for_voting', 'finalist', 'winner'])
    .order('leaderboard_score', { ascending: false })
    .order('public_vote_count', { ascending: false })
    .limit(Math.max(1, Math.min(500, limit)));

  if (error) {
    logger.error({ error, competitionId }, 'Error fetching competition leaderboard');
    throw error;
  }

  logger.info({ competitionId, count: data?.length }, 'Leaderboard fetched successfully');
  return data || [];
}

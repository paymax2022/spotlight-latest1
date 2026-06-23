import { getAdminServiceContext } from './context';
import { logger } from '@/lib/logger';

export async function getCompetitionVotePolicy(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('contests')
    .select('id, vote_price_ngn, judge_weight, public_vote_weight')
    .eq('id', competitionId)
    .maybeSingle();

  if (error) {
    logger.error({ error, competitionId }, 'Error fetching competition vote policy');
    throw error;
  }
  return data;
}

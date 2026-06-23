import { getAdminServiceContext } from './context';

export async function listCompetitionWinners(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('winner_records')
    .select('id, competition_id, entry_id, user_id, rank_position, title, winner_type, created_at')
    .eq('competition_id', competitionId)
    .order('rank_position', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

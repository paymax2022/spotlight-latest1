import { getAdminServiceContext } from './context';

export async function getCompetitionReportSummary(competitionId: string) {
  const { supabase } = getAdminServiceContext();

  const [enrollmentsRes, entriesRes, votesRes] = await Promise.all([
    supabase
      .from('competition_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId),
    supabase
      .from('competition_entries')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', competitionId),
    supabase
      .from('contestant_votes')
      .select('id', { count: 'exact', head: true })
      .eq('contest_id', competitionId),
  ]);

  if (enrollmentsRes.error) throw enrollmentsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (votesRes.error) throw votesRes.error;

  return {
    enrollments: enrollmentsRes.count || 0,
    entries: entriesRes.count || 0,
    votes: votesRes.count || 0,
  };
}

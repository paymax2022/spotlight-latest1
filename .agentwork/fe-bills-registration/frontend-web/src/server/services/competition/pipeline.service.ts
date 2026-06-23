import { getAdminServiceContext } from './context';

export async function listPipelineRecords(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('talent_pipeline_records')
    .select(
      'id, user_id, competition_id, category_id, stage, tags, assigned_admin_id, next_action_at, is_alumni, created_at'
    )
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

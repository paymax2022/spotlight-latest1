import { getAdminServiceContext } from './context';

export async function getCompetitionById(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('contests')
    .select(
      'id, slug, name, description, status, contest_type, visibility, is_featured, start_date, end_date, created_at'
    )
    .eq('id', competitionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function listCompetitionCategories(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_categories')
    .select(
      'id, competition_id, category_id, subcategory_slug, config_overrides, is_active, skill_categories(id, title, slug)'
    )
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

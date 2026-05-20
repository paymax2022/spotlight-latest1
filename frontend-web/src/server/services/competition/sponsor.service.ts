import { getAdminServiceContext } from './context';

export async function listActivePlacements(competitionId: string) {
  const { supabase } = getAdminServiceContext();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('sponsor_placements')
    .select('id, placement_key, sponsor_name, campaign_name, asset_url, target_url, tracking_code')
    .eq('competition_id', competitionId)
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

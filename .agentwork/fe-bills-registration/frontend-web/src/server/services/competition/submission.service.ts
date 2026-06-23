import { ApiError } from '@/lib/api/responses';
import { getAdminServiceContext } from './context';

export async function getEntryForOwner(entryId: string, userId: string) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('competition_entries')
    .select('id, competition_id, user_id, status, submitted_at, updated_at')
    .eq('id', entryId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.user_id !== userId) {
    throw new ApiError('Entry not found', 404);
  }

  return data;
}

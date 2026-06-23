import { ApiError } from '@/lib/api/responses';
import { getAdminServiceContext } from './context';

export async function assertJudgeAssignment(
  competitionId: string,
  judgeId: string,
  category?: string
) {
  const { supabase } = getAdminServiceContext();
  const { data, error } = await supabase
    .from('judge_assignments')
    .select('id, judge_id, category, active')
    .eq('competition_id', competitionId)
    .eq('judge_id', judgeId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ApiError('Judge is not assigned to this competition', 403);
  if (category && data.category && category !== data.category) {
    throw new ApiError('Judge is not assigned to this category', 403);
  }

  return data;
}

import { getAdminServiceContext } from './context';
import type { PaginationInput, PaginatedResult } from './types';

export async function listSkillCategories(
  input: PaginationInput = {}
): Promise<PaginatedResult<Record<string, unknown>>> {
  const page = Math.max(1, input.page || 1);
  const limit = Math.min(100, Math.max(1, input.limit || 20));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { supabase } = getAdminServiceContext();

  const { data, error } = await supabase
    .from('skill_categories')
    .select(
      'id, title, slug, description, vertical_group, active, featured, sort_order, created_at'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { items: data || [], page, limit };
}

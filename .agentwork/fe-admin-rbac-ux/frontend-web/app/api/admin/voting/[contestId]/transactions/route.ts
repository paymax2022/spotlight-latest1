import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'finance:view');
    const { contestId } = await context.params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(500, Number(searchParams.get('limit') ?? 100));
    const offset = Number(searchParams.get('offset') ?? 0);
    const search = searchParams.get('search');

    const supabase = createAdminClient();
    let query = supabase
      .from('vote_transactions')
      .select('*', { count: 'exact' })
      .eq('contest_id', contestId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('payment_status', status);
    if (search) query = query.ilike('payment_reference', `%${search}%`);

    const { data, error, count } = await query;
    if (error) return Response.json({ success: false, error: error.message }, { status: 500 });

    return successResponse({ success: true, transactions: data ?? [], total: count ?? 0 });
  } catch (error) {
    return handleApiError(error, 'Failed to load transactions');
  }
}

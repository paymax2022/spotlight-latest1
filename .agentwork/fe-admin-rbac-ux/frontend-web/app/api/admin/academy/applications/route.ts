import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'applications:review');
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const status  = searchParams.get('status');

    const supabase = createAdminClient();
    let query = supabase
      .from('academy_applications')
      .select('id, full_name, email, phone, status, payment_status, application_fee_paid, created_at, batch_id, areas_of_interest, academy_batches(batch_name)')
      .order('created_at', { ascending: false });

    if (batchId) query = query.eq('batch_id', batchId);
    if (status)  query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return errorResponse('Failed to load applications', 500);
    return successResponse({ success: true, applications: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load applications');
  }
}

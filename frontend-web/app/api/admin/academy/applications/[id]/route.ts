import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { updateAcademyApplicationReview } from '@/src/server/services/academy/service';
import { autoCreateInstallmentPlan } from '@/src/server/services/academy/installments';
import { createAdminClient } from '@/lib/supabase/server';
import type { AcademyReviewUpdateInput } from '@/src/lib/validation/academy';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'applications:review');
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_applications')
      .select('*, academy_batches(batch_name, start_date), academy_installment_plans(id, total_amount_ngn, installments_count, status, academy_installment_payments(*))')
      .eq('id', params.id)
      .maybeSingle();
    if (error || !data) return errorResponse('Application not found', 404);
    return successResponse({ success: true, application: data });
  } catch (error) {
    return handleApiError(error, 'Failed to load application');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as AcademyReviewUpdateInput;
    const supabase = createAdminClient();
    const updated = await updateAcademyApplicationReview(
      supabase,
      params.id,
      identity.actorId,
      body,
    );

    // Auto-generate installment plan when application is approved
    if (body.status === 'approved') {
      const { data: app } = await supabase
        .from('academy_applications')
        .select('batch_id')
        .eq('id', params.id)
        .maybeSingle();

      if (app?.batch_id) {
        await autoCreateInstallmentPlan(params.id, app.batch_id, new Date().toISOString());
      }
    }

    return successResponse({ success: true, application: updated });
  } catch (error) {
    return handleApiError(error, 'Failed to update application');
  }
}

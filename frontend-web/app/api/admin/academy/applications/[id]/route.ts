import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import {
  updateAcademyApplicationReview,
  sendAcademyApplicationApprovedEmail,
  sendAcademyApplicationRejectedEmail,
} from '@/src/server/services/academy/service';
import { autoCreateInstallmentPlan } from '@/src/server/services/academy/installments';
import { ensureEnrollment } from '@/src/server/services/academy/enrollment';
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
        .select('batch_id, academy_batches(batch_name)')
        .eq('id', params.id)
        .maybeSingle();

      if (app?.batch_id) {
        await autoCreateInstallmentPlan(params.id, app.batch_id, new Date().toISOString());
      }

      // A batch with no tuition owes nothing, so approval alone earns the enrolment.
      // Where tuition IS due this is a no-op until the first instalment settles.
      await ensureEnrollment(supabase, params.id).catch((e) => {
        console.error('[admin/academy/applications] enrolment after approval failed', e);
      });

      if (updated?.email) {
        const batchName = (app as { academy_batches?: { batch_name?: string | null } | null } | null)
          ?.academy_batches?.batch_name;
        await sendAcademyApplicationApprovedEmail({
          email: updated.email,
          fullName: updated.full_name,
          batchName,
          tuitionOwedNgn: (updated as { tuition_total_ngn?: number | null }).tuition_total_ngn,
        }).catch((e) => {
          console.error('[admin/academy/applications] approval email failed', e);
        });
      }
    }

    if (body.status === 'rejected' && updated?.email) {
      await sendAcademyApplicationRejectedEmail({
        email: updated.email,
        fullName: updated.full_name,
        rejectionReason: (updated as { rejection_reason?: string | null }).rejection_reason,
      }).catch((e) => {
        console.error('[admin/academy/applications] rejection email failed', e);
      });
    }

    return successResponse({ success: true, application: updated });
  } catch (error) {
    return handleApiError(error, 'Failed to update application');
  }
}

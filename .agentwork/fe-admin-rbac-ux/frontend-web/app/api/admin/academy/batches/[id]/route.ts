import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { saveAcademyBatch, deleteAcademyBatch } from '@/src/server/services/academy/service';
import { createAdminClient } from '@/lib/supabase/server';
import type { AcademyBatchMutationInput } from '@/src/lib/validation/academy';

function getBatchFeeFields(body: Record<string, unknown>) {
  const extra: Record<string, unknown> = {};

  if (body.training_fee_ngn !== undefined) extra.training_fee_ngn = Number(body.training_fee_ngn);
  if (body.installments_count !== undefined) extra.installments_count = Number(body.installments_count);
  if (body.fee_frequency !== undefined) extra.fee_frequency = String(body.fee_frequency);
  if (body.one_off_discount_pct !== undefined) extra.one_off_discount_pct = Number(body.one_off_discount_pct);
  if (body.fee_start_offset_days !== undefined) {
    extra.fee_start_offset_days = Number(body.fee_start_offset_days);
  }

  return extra;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('academy_batches')
      .select('*, academy_applications(count)')
      .eq('id', params.id)
      .maybeSingle();
    if (error || !data) return errorResponse('Batch not found', 404);
    return successResponse({ success: true, batch: data });
  } catch (error) {
    return handleApiError(error, 'Failed to load batch');
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const body = (await request.json()) as AcademyBatchMutationInput & Record<string, unknown>;
    const supabase = createAdminClient();
    const batch = await saveAcademyBatch(supabase as any, body, params.id);
    const extra = getBatchFeeFields(body);

    if (Object.keys(extra).length > 0) {
      const { data, error } = await supabase
        .from('academy_batches')
        .update(extra)
        .eq('id', params.id)
        .select('*')
        .single();

      if (error || !data) return errorResponse('Failed to update batch fee settings', 500);
      return successResponse({ success: true, batch: data });
    }

    return successResponse({ success: true, batch });
  } catch (error) {
    return handleApiError(error, 'Failed to update batch');
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    await deleteAcademyBatch(supabase as any, params.id);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete batch');
  }
}

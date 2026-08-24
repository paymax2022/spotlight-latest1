import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { saveAcademyBatch, getAcademyAdminDashboard } from '@/src/server/services/academy/service';
import { createAdminClient } from '@/lib/supabase/server';
import { replaceBatchAreas } from '@/src/server/services/academy/batchAreas';
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


export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const dashboard = await getAcademyAdminDashboard(supabase as any);
    return successResponse({ success: true, batches: (dashboard as any).batches ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load batches');
  }
}

export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const body = (await request.json()) as AcademyBatchMutationInput & Record<string, unknown>;
    const supabase = createAdminClient();
    const batch = await saveAcademyBatch(supabase as any, body);

    // Persist fee fields not in the base mutation type.
    const extra = getBatchFeeFields(body);
    if (Object.keys(extra).length > 0) {
      await supabase.from('academy_batches').update(extra).eq('id', (batch as any).id);
    }

    await replaceBatchAreas(supabase, String((batch as any).id), body.interest_area_slugs);

    return successResponse({ success: true, batch }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create batch');
  }
}

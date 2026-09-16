import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const biller = await adminUpdateUtilityRow('utility_billers', params.id, await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.biller.update',
      entityType: 'utility_biller',
      entityId: params.id,
      newValue: biller,
    });
    return successResponse({ success: true, biller });
  } catch (err) {
    return handleApiError(err);
  }
}

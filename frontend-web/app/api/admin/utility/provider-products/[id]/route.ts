import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const mapping = await adminUpdateUtilityRow('utility_provider_product_mappings', params.id, await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider_product_mapping.update',
      entityType: 'utility_provider_product_mapping',
      entityId: params.id,
      newValue: mapping,
    });
    return successResponse({ success: true, mapping });
  } catch (err) {
    return handleApiError(err);
  }
}

import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);
    const mapping = await adminUpdateUtilityRow('utility_provider_product_mappings', params.id, body as Record<string, unknown>);
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

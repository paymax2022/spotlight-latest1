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
    const product = await adminUpdateUtilityRow('utility_products', params.id, body as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.product.update',
      entityType: 'utility_product',
      entityId: params.id,
      newValue: product,
    });
    return successResponse({ success: true, product });
  } catch (err) {
    return handleApiError(err);
  }
}

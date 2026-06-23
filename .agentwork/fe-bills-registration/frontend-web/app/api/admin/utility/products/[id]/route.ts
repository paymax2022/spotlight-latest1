import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const product = await adminUpdateUtilityRow('utility_products', params.id, await request.json() as Record<string, unknown>);
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

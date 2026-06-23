import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, { params }: { params: { category: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const identity = await requireUtilityManager(request);
    const category = await adminUpdateUtilityRow('utility_category_settings', params.category, await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.category.update',
      entityType: 'utility_category_setting',
      entityId: params.category,
      newValue: category,
    });
    return successResponse({ success: true, category });
  } catch (err) {
    return handleApiError(err);
  }
}

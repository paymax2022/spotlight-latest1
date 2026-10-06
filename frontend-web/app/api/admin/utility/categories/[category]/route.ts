import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, ctx: { params: Promise<{ category: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const identity = await requireUtilityManager(request);
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);
    const category = await adminUpdateUtilityRow('utility_category_settings', params.category, body as Record<string, unknown>);
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

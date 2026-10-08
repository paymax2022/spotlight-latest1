import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const payload = await request.json().catch(() => null) as Record<string, unknown>;
    if (!payload) return errorResponse('Invalid JSON body', 400);
    const provider = await adminUpdateUtilityRow('utility_providers', params.id, payload);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider.update',
      entityType: 'utility_provider',
      entityId: params.id,
      newValue: provider,
    });
    return successResponse({ success: true, provider });
  } catch (err) {
    return handleApiError(err);
  }
}

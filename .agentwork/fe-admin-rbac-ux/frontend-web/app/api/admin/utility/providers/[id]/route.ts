import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const payload = await request.json() as Record<string, unknown>;
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

import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminHealthCheckProvider } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const health = await adminHealthCheckProvider(params.id);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider.health_check',
      entityType: 'utility_provider',
      entityId: params.id,
      newValue: health,
    });
    return successResponse({ success: true, health });
  } catch (err) {
    return handleApiError(err);
  }
}

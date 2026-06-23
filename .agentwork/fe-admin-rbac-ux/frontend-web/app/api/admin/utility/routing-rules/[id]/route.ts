import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../_utils';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;
  try {
    const identity = await requireUtilityManager(request);
    const routing_rule = await adminUpdateUtilityRow('utility_routing_rules', params.id, await request.json() as Record<string, unknown>);
    auditUtilityAdminAction(request, identity, {
      action: 'utility.routing_rule.update',
      entityType: 'utility_routing_rule',
      entityId: params.id,
      newValue: routing_rule,
    });
    return successResponse({ success: true, routing_rule });
  } catch (err) {
    return handleApiError(err);
  }
}

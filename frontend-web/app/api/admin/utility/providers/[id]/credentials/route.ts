import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { adminUpdateUtilityRow } from '@/src/server/utility/service';
import { auditUtilityAdminAction, requireUtilityManager, utilityAdminUnavailableResponse } from '../../../_utils';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityAdminUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const identity = await requireUtilityManager(request);
    const body = await request.json() as Record<string, unknown>;
    const credentials = body.credentials;
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return errorResponse('credentials object is required.', 400);
    }

    const provider = await adminUpdateUtilityRow('utility_providers', params.id, { credentials });
    auditUtilityAdminAction(request, identity, {
      action: 'utility.provider.credentials.rotate',
      entityType: 'utility_provider',
      entityId: params.id,
      newValue: { credentials_configured: true },
    });

    return successResponse({ success: true, provider });
  } catch (err) {
    return handleApiError(err);
  }
}

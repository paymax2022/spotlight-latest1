import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { createUtilityDispute } from '@/src/server/utility/service';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../../../_utils';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'dispute', user.id, 10, 60_000);
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return errorResponse('reason is required.', 400);
    return successResponse({ success: true, dispute: await createUtilityDispute(user.id, params.id, reason) }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { deleteUtilityBeneficiary } from '@/src/server/utility/service';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../../_utils';

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'beneficiary-delete', user.id, 20, 60_000);
    if (limited) return limited;
    await deleteUtilityBeneficiary(user.id, params.id);
    return successResponse({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

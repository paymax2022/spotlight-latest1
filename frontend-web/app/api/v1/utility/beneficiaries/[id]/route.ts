import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../../_utils';

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'beneficiary-delete', user.id, 20, 60_000);
    if (limited) return limited;

    // Proxy to Go backend (DELETE method)
    const upstream = await proxyToGoBackend(request, `/api/finance/utilitybills/beneficiaries/${params.id}`, {
      method: 'DELETE',
    });

    if (upstream.status >= 400) {
      return upstream;
    }

    // Go returns 204 No Content, but Next.js wrapper returns success: true
    return successResponse({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

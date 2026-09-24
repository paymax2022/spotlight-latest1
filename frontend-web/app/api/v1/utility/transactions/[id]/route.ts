import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { requireUtilityUser, utilityUnavailableResponse } from '../../_utils';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);
    // Proxy to Go backend to get transaction details
    const upstream = await proxyToGoBackend(request, `/api/finance/utilitybills/transactions/${params.id}`);

    if (upstream.status >= 400) {
      return upstream;
    }

    const data = await upstream.json() as Record<string, unknown>;

    // Also fetch attempts from the separate Go endpoint
    const attemptsUpstream = await proxyToGoBackend(
      request,
      `/api/finance/utilitybills/transactions/${params.id}/attempts`,
    );

    let attempts: unknown[] = [];
    if (attemptsUpstream.status < 400) {
      const attemptsData = await attemptsUpstream.json() as Record<string, unknown>;
      if (Array.isArray(attemptsData.attempts)) {
        attempts = attemptsData.attempts;
      }
    }

    return successResponse({
      success: true,
      transaction: data.transaction,
      attempts,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

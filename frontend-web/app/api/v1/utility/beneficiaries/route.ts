import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'beneficiary-save', user.id, 20, 60_000);
    if (limited) return limited;

    // Proxy to Go backend (query params forwarded automatically)
    const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/beneficiaries');

    if (upstream.status >= 400) {
      return upstream;
    }

    const data = await upstream.json() as Record<string, unknown>;
    return successResponse({ success: true, beneficiaries: data.beneficiaries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);

    // Read the request body and forward it to the Go backend
    const body = await request.json() as Record<string, unknown>;

    // Proxy to Go backend with the request body
    const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/beneficiaries', {
      method: 'POST',
      body,
    });

    if (upstream.status >= 400) {
      return upstream;
    }

    const data = await upstream.json() as Record<string, unknown>;
    // Go returns 200, but Next.js convention is 201 for resource creation
    return successResponse({ success: true, beneficiary: data.beneficiary }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

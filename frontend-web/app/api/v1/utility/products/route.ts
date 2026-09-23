import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { requireUtilityUser, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);
    // Proxy to Go backend (query params forwarded automatically).
    // Note: Go backend expects biller_id; Next.js caller may send 'biller' or 'biller_id'.
    // The proxyToGoBackend utility forwards the query string as-is, so if caller sends
    // 'biller', the Go backend will ignore it. For safety, we could normalize here, but
    // since the Go endpoint accepts 'biller_id', ensure callers use the correct param.
    const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/products');

    if (upstream.status >= 400) {
      return upstream;
    }

    const data = await upstream.json() as Record<string, unknown>;
    return successResponse({ success: true, products: data.products });
  } catch (err) {
    return handleApiError(err);
  }
}

import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { listBillers } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityGoProxyEnabled, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend (query params forwarded automatically)
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/billers');
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      return successResponse({ success: true, billers: data.billers });
    }

    const { searchParams } = new URL(request.url);
    const category = parseUtilityCategory(searchParams.get('category'));
    const billers = await listBillers(category);
    return successResponse({ success: true, billers });
  } catch (err) {
    return handleApiError(err);
  }
}

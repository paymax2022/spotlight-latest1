import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { listUtilityCategories } from '@/src/server/utility/service';
import { requireUtilityUser, utilityGoProxyEnabled, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);

    if (utilityGoProxyEnabled()) {
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/categories');
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      return successResponse({ success: true, categories: data.categories });
    }

    const categories = await listUtilityCategories();
    return successResponse({ success: true, categories });
  } catch (err) {
    return handleApiError(err);
  }
}

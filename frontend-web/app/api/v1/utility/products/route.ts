import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { getBillerByCode, listProducts } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityGoProxyEnabled, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    await requireUtilityUser(request);

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend (query params forwarded automatically — Go accepts
      // both biller_id (uuid) and biller (code slug) and resolves the latter
      // server-side, so no normalization is needed here).
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/products');
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      return successResponse({ success: true, products: data.products });
    }

    const { searchParams } = new URL(request.url);
    const category = parseUtilityCategory(searchParams.get('category'));
    let billerId = searchParams.get('biller_id') || searchParams.get('billerId') || undefined;
    const billerCode = searchParams.get('biller')?.trim();
    if (!billerId && billerCode) {
      // `biller` is the public code slug — resolve it to an id. An unknown code
      // returns an EMPTY list, the same as a nonexistent biller_id filter.
      const biller = await getBillerByCode(billerCode);
      if (!biller) return successResponse({ success: true, products: [] });
      billerId = biller.id;
    }
    const products = await listProducts({ category, billerId });
    return successResponse({ success: true, products });
  } catch (err) {
    return handleApiError(err);
  }
}

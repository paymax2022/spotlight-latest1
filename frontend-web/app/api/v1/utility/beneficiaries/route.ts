import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import {
  listUtilityBeneficiaries,
  saveUtilityBeneficiary,
} from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityGoProxyEnabled, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'beneficiary-save', user.id, 20, 60_000);
    if (limited) return limited;

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend (query params forwarded automatically)
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/beneficiaries');
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      return successResponse({ success: true, beneficiaries: data.beneficiaries });
    }

    const category = parseUtilityCategory(new URL(request.url).searchParams.get('category'));
    const beneficiaries = await listUtilityBeneficiaries(user.id, category);
    return successResponse({ success: true, beneficiaries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const body = await request.json().catch(() => null) as Record<string, unknown>;
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (utilityGoProxyEnabled()) {
      // Proxy to Go backend with the request body
      const upstream = await proxyToGoBackend(request, '/api/finance/utilitybills/beneficiaries', {
        method: 'POST',
        body,
      });
      if (upstream.status >= 400) return upstream;
      const data = await upstream.json() as Record<string, unknown>;
      // Go returns 200, but Next.js convention is 201 for resource creation
      return successResponse({ success: true, beneficiary: data.beneficiary }, 201);
    }

    const category = parseUtilityCategory(String(body.category || ''));
    if (!category) return errorResponse('category is required.', 400);
    const beneficiary = await saveUtilityBeneficiary(user.id, {
      category,
      billerId: String(body.biller_id || body.billerId || ''),
      label: String(body.label || ''),
      customerReference: String(body.customer_reference || body.customerReference || ''),
      customerName: typeof body.customer_name === 'string' ? body.customer_name : typeof body.customerName === 'string' ? body.customerName : undefined,
    });
    return successResponse({ success: true, beneficiary }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

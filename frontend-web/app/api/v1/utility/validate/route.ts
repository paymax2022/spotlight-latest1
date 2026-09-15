import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { validateUtilityCustomer } from '@/src/server/utility/service';
import {
  callUtilityBillsGo,
  parseUtilityCategory,
  requireUtilityReader,
  utilityGoProxyEnabled,
  utilityRateLimit,
  utilityUnavailableResponse,
} from '../_utils';

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    // Validation is a read-only lookup — auth required, but NOT a KYC tier
    // (the pay / paystack-initiate routes still enforce Tier 1).
    const user = await requireUtilityReader(request);
    const limited = utilityRateLimit(request, 'validate', user.id, 40, 60_000);
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const category = parseUtilityCategory(String(body.category || ''));
    if (!category) return errorResponse('category is required.', 400);

    // Forward the meter type (prepaid/postpaid) the provider needs to verify an
    // electricity meter. Accept either a top-level field or a metadata object.
    const bodyMeta = (body.metadata && typeof body.metadata === 'object') ? body.metadata as Record<string, unknown> : {};
    const meterType = String(body.meter_type || body.meterType || body.type || bodyMeta.type || '').toLowerCase();
    const metadata: Record<string, unknown> = { ...bodyMeta };
    if (meterType) metadata.type = meterType;

    const billerId = String(body.biller_id || body.billerId || '');
    const productId = typeof body.product_id === 'string' ? body.product_id : typeof body.productId === 'string' ? body.productId : undefined;
    const customerReference = String(body.customer_reference || body.customerReference || '');

    if (utilityGoProxyEnabled()) {
      // Go's ValidateInput.Metadata is map[string]string — stringify every
      // value so a non-string field (e.g. a stray number) doesn't 400 at the
      // Gin JSON binder instead of reaching validation.
      const stringMetadata = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)]));
      const result = await callUtilityBillsGo(request, '/api/finance/utilitybills/validate', {
        category,
        biller_id: billerId,
        product_id: productId ?? '',
        customer_reference: customerReference,
        metadata: stringMetadata,
      });
      if (!result.ok) return result.response;
      return successResponse({ success: true, ...result.data });
    }

    const result = await validateUtilityCustomer({
      category,
      billerId,
      productId,
      customerReference,
      metadata,
    });

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

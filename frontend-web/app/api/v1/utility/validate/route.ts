import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { validateUtilityCustomer } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityReader, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

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

    const result = await validateUtilityCustomer({
      category,
      billerId: String(body.biller_id || body.billerId || ''),
      productId: typeof body.product_id === 'string' ? body.product_id : typeof body.productId === 'string' ? body.productId : undefined,
      customerReference: String(body.customer_reference || body.customerReference || ''),
      metadata,
    });

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { validateUtilityCustomer } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'validate', user.id, 40, 60_000);
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const category = parseUtilityCategory(String(body.category || ''));
    if (!category) return errorResponse('category is required.', 400);

    const result = await validateUtilityCustomer({
      category,
      billerId: String(body.biller_id || body.billerId || ''),
      productId: typeof body.product_id === 'string' ? body.product_id : typeof body.productId === 'string' ? body.productId : undefined,
      customerReference: String(body.customer_reference || body.customerReference || ''),
    });

    return successResponse({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

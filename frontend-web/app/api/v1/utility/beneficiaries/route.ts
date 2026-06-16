import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import {
  listUtilityBeneficiaries,
  saveUtilityBeneficiary,
} from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'beneficiary-save', user.id, 20, 60_000);
    if (limited) return limited;
    const category = parseUtilityCategory(new URL(request.url).searchParams.get('category'));
    return successResponse({ success: true, beneficiaries: await listUtilityBeneficiaries(user.id, category) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const body = await request.json() as Record<string, unknown>;
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

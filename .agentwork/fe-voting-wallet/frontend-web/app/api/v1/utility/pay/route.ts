import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { payUtility } from '@/src/server/utility/service';
import { parseUtilityCategory, requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../_utils';

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for utility payments.', 400);

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'pay', user.id, 10, 60_000);
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const category = parseUtilityCategory(String(body.category || ''));
    if (!category) return errorResponse('category is required.', 400);

    const result = await payUtility(user.id, {
      category,
      billerId: String(body.biller_id || body.billerId || ''),
      productId: String(body.product_id || body.productId || ''),
      customerReference: String(body.customer_reference || body.customerReference || ''),
      amountKobo: typeof body.amount_kobo === 'number' ? body.amount_kobo : typeof body.amountKobo === 'number' ? body.amountKobo : undefined,
      paymentSource: 'wallet',
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata as Record<string, unknown> : {},
      idempotencyKey,
    });

    return NextResponse.json(
      { success: true, already_processed: result.alreadyProcessed, transaction: result.transaction },
      { status: result.alreadyProcessed ? 200 : 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

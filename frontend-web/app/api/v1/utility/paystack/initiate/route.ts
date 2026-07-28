import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { parseUtilityCategory, requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../../_utils';
import { initiateUtilityPaystackPayment } from '../_service';

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for Paystack utility payments.', 400);

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'paystack-initiate', user.id, 10, 60_000);
    if (limited) return limited;

    const body = await request.json() as Record<string, unknown>;
    const category = parseUtilityCategory(String(body.category || ''));
    if (!category) return errorResponse('category is required.', 400);

    const result = await initiateUtilityPaystackPayment({
      request,
      userId: user.id,
      email: user.email ?? '',
      category,
      billerId: String(body.biller_id || body.billerId || ''),
      productId: String(body.product_id || body.productId || ''),
      customerReference: String(body.customer_reference || body.customerReference || ''),
      amountKobo: typeof body.amount_kobo === 'number' ? body.amount_kobo : typeof body.amountKobo === 'number' ? body.amountKobo : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata as Record<string, unknown> : {},
      idempotencyKey,
    });

    return NextResponse.json({
      success: true,
      already_processed: result.alreadyProcessed,
      intent: result.intent,
      payment_reference: result.paymentReference,
      authorization_url: result.authorizationUrl,
    }, { status: result.alreadyProcessed ? 200 : 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

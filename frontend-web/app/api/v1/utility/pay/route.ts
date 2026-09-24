import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { payUtility } from '@/src/server/utility/service';
import {
  callUtilityBillsGo,
  parseUtilityCategory,
  requireUtilityUser,
  utilityGoProxyEnabled,
  utilityRateLimit,
  utilityUnavailableResponse,
} from '../_utils';

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

    const billerId = String(body.biller_id || body.billerId || '');
    const productId = String(body.product_id || body.productId || '');
    const customerReference = String(body.customer_reference || body.customerReference || '');
    const amountKobo = typeof body.amount_kobo === 'number' ? body.amount_kobo : typeof body.amountKobo === 'number' ? body.amountKobo : undefined;
    const metadata = typeof body.metadata === 'object' && body.metadata !== null ? body.metadata as Record<string, unknown> : {};

    if (utilityGoProxyEnabled()) {
      const result = await callUtilityBillsGo(request, '/api/finance/utilitybills/pay', {
        category,
        biller_id: billerId,
        product_id: productId,
        customer_reference: customerReference,
        amount_kobo: amountKobo,
        payment_source: 'wallet',
        metadata,
      });
      if (!result.ok) return result.response;
      // Go's handler always answers 200; this route's own long-standing contract
      // (what mobile/web already call) is 201 for a fresh purchase, 200 for a
      // replayed one — preserve that here rather than leaking Go's status code.
      const alreadyProcessed = Boolean(result.data.already_processed);
      return NextResponse.json(
        { success: true, already_processed: alreadyProcessed, transaction: result.data.transaction },
        { status: alreadyProcessed ? 200 : 201 },
      );
    }

    const result = await payUtility(user.id, {
      category,
      billerId,
      productId,
      customerReference,
      amountKobo,
      paymentSource: 'wallet',
      metadata,
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

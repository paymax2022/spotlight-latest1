import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireUtilityUser, utilityRateLimit, utilityUnavailableResponse } from '../../_utils';
import { verifyUtilityPaystackPayment } from '../_service';

export async function POST(request: Request) {
  const unavailable = utilityUnavailableResponse();
  if (unavailable) return unavailable;

  try {
    const user = await requireUtilityUser(request);
    const limited = utilityRateLimit(request, 'paystack-verify', user.id, 20, 60_000);
    if (limited) return limited;
    const body = await request.json() as Record<string, unknown>;
    const result = await verifyUtilityPaystackPayment(String(body.reference || body.payment_reference || ''), user.id);
    return NextResponse.json({
      success: true,
      already_processed: result.alreadyProcessed,
      transaction: result.transaction,
      transactionId: result.transaction?.id,
      transaction_id: result.transaction?.id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

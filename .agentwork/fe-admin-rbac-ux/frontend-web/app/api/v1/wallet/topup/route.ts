import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { createTopupIntent } from '@/src/server/wallet/service';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  if (!featureFlags.wallet()) return errorResponse('Wallet feature is not available.', 503);

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) {
    return errorResponse('Idempotency-Key header is required for wallet mutations.', 400);
  }

  try {
    const user = await requireRequestUser(request);
    await requireKycTier(user.id, 1);

    const body = await request.json() as Record<string, unknown>;
    const amountKobo = body.amount_kobo;

    if (typeof amountKobo !== 'number' || !Number.isInteger(amountKobo) || amountKobo <= 0) {
      return errorResponse('amount_kobo must be a positive integer (kobo).', 400);
    }

    const callbackUrl = typeof body.callback_url === 'string' ? body.callback_url : undefined;

    const result = await createTopupIntent(user.id, user.email ?? '', {
      amountKobo,
      idempotencyKey,
      callbackUrl,
    });

    return NextResponse.json(
      {
        success: true,
        already_processed: result.alreadyProcessed,
        intent_id: result.intentId,
        payment_reference: result.paymentReference,
        authorization_url: result.authorizationUrl,
        amount_kobo: result.amountKobo,
      },
      { status: result.alreadyProcessed ? 200 : 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

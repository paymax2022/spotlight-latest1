import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { assertTopupAllowed, type TopupPurpose } from '@/src/server/wallet/topup-gate';
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

    const body = await request.json() as Record<string, unknown>;
    const amountKobo = body.amount_kobo;

    if (typeof amountKobo !== 'number' || !Number.isInteger(amountKobo) || amountKobo <= 0) {
      return errorResponse('amount_kobo must be a positive integer (kobo).', 400);
    }

    // A checkout top-up exists to fund the purchase that raised it (ADR-041), so it
    // carries a different KYC gate from standalone funding: it may be permitted
    // below Tier 1 under a capped allowance (ADR-042). Anything not explicitly
    // 'checkout' is treated as standalone funding and keeps the Tier 1 gate — an
    // unrecognised value must never buy the weaker gate.
    const purpose: TopupPurpose = body.purpose === 'checkout' ? 'checkout' : 'wallet';
    await assertTopupAllowed(user.id, amountKobo, purpose);

    const callbackUrl = typeof body.callback_url === 'string' ? body.callback_url : undefined;

    const result = await createTopupIntent(user.id, user.email ?? '', {
      amountKobo,
      idempotencyKey,
      callbackUrl,
      purpose,
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

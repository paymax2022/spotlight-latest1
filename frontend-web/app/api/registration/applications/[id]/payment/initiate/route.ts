import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  getRegistrationDraft,
  findRegistrationPaymentIntentByIdempotencyKey,
  createRegistrationPaymentIntent,
} from '@/src/server/registration/supabase-store';

// Registration fee payment — real Paystack gateway (test mode; the same
// `initializePaystackPayment` helper the utility/bills module uses). This
// replaces what used to be a client-fabricated
// `https://checkout.paystack.com/mock?ref=...` URL, which always failed
// because Paystack never actually issued that reference.
//
// Only method=PAYSTACK is handled here. Wallet-funded registration fees would
// need a real ledger debit (escrow hold + release, idempotency, audit — the
// same iron rules as every other money mutation in this codebase) which does
// not exist yet for this module; rather than fake that too, WALLET is
// rejected with a clear error until that's built.
function reference() {
  return `SPT-REG-${crypto.randomUUID().replace(/-/g, '').slice(0, 18).toUpperCase()}`;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!idempotencyKey) return errorResponse('Idempotency-Key header is required for registration payments.', 400);

  try {
    const { user } = await requireUser(request);

    const limited = checkRateLimit(`registration:payment-initiate:${user.id}`, 10, 60_000);
    if (!limited.allowed) return errorResponse('Too many payment attempts. Please slow down.', 429);

    const draft = await getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    const body = (await request.json()) as { method?: string; email?: string };
    const method = String(body.method || '').toUpperCase();
    if (method !== 'PAYSTACK') {
      return errorResponse(
        'Only Paystack registration payments are supported right now — wallet debits for registration fees are not yet available.',
        400,
      );
    }

    // Never trust a client-supplied amount for a money mutation: the fee is
    // pinned server-side from the authoritative draft (contest fee, locked at
    // draft creation / step save — see saveRegistrationStep).
    const feeNgn = Number(draft.formData['payment.feeAmount'] ?? 0);
    if (!(feeNgn > 0)) {
      return errorResponse('This application has no outstanding registration fee.', 400);
    }
    const amountKobo = Math.round(feeNgn * 100);

    // Idempotency-Key replay: return the same intent rather than opening a
    // second Paystack transaction for a retried/duplicate request.
    const existing = findRegistrationPaymentIntentByIdempotencyKey(idempotencyKey);
    if (existing) {
      return NextResponse.json({
        success: true,
        transactionId: existing.id,
        reference: existing.paymentReference,
        status: existing.status === 'completed' ? 'completed' : 'initiated',
      }, { status: 200 });
    }

    const paymentReference = reference();
    const callbackUrl = new URL(
      `/api/registration/applications/${params.id}/payment/callback?reference=${encodeURIComponent(paymentReference)}`,
      request.url,
    ).toString();

    const authorizationUrl = await initializePaystackPayment({
      reference: paymentReference,
      email: body.email || user.email || '',
      amount: amountKobo,
      currency: 'NGN',
      callbackUrl,
      metadata: {
        type: 'registration_payment',
        application_id: params.id,
        user_id: user.id,
      },
    });

    const intent = createRegistrationPaymentIntent({
      applicationId: params.id,
      userId: user.id,
      amountKobo,
      paymentReference,
      idempotencyKey,
    });

    return NextResponse.json({
      success: true,
      transactionId: intent.id,
      reference: paymentReference,
      authorizationUrl,
      status: 'initiated',
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to start registration payment');
  }
}

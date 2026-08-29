import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  getRegistrationPaymentIntentByReference,
  markRegistrationPaymentIntentStatus,
  applyRegistrationPaymentSuccess,
} from '@/src/server/registration/supabase-store';

// Public landing point Paystack redirects the user's BROWSER to after
// checkout (payment/initiate's callback_url) — a plain top-level navigation,
// so there is no Authorization header to reuse payment/verify's auth-gated
// GET. This route existed only as a URL initiate built and pointed Paystack
// at; nothing ever implemented it, so every registration payment redirect
// 404'd here regardless of whether the charge succeeded.
//
// Mirrors /api/v1/utility/paystack/callback's pattern: verify + record the
// payment server-side (trusting the payment intent's own stored
// applicationId rather than a request header, since none is available),
// then hand off to the native app via its paymaxrn:// scheme — same
// deep-link convention that route already uses, expo-router maps it onto
// app/registration/[id]/payment-processing.tsx. In local web testing a bare
// browser tab won't follow a custom scheme (nothing registered to catch
// it); that's an existing limitation of this same pattern elsewhere, not
// new here. The verification below still lands correctly regardless — the
// app's own payment-processing screen re-verifies on its own return
// (useVerifyRegistrationPayment), the same self-healing fallback wallet
// top-up already relies on for a Paystack redirect that never reaches it.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const url = new URL(request.url);
    const reference = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
    if (!reference) return redirectToApp(params.id, 'FAILED');

    const intent = await getRegistrationPaymentIntentByReference(reference);
    if (!intent || intent.applicationId !== params.id) {
      return redirectToApp(params.id, 'FAILED', reference);
    }

    if (intent.status === 'completed') {
      return redirectToApp(params.id, 'SUCCESSFUL', reference, intent.id);
    }

    const verification = await verifyPaystackPayment(reference);
    if (!verification.success) {
      // Not-yet-settled, same "keep polling" treatment payment/verify gives
      // it — the redirect target's own verify call resolves this properly;
      // this route's job is best-effort recording, not the final word.
      return redirectToApp(params.id, 'PENDING', reference, intent.id);
    }

    if (verification.amountKobo < intent.amountKobo) {
      await markRegistrationPaymentIntentStatus(intent.id, 'failed', 'Paystack amount is lower than the registration fee.');
      return redirectToApp(params.id, 'FAILED', reference, intent.id);
    }

    await applyRegistrationPaymentSuccess(params.id, { reference, method: 'PAYSTACK' });
    await markRegistrationPaymentIntentStatus(intent.id, 'completed');

    return redirectToApp(params.id, 'SUCCESSFUL', reference, intent.id);
  } catch (error) {
    return handleApiError(error, 'Failed to process registration payment callback');
  }
}

function redirectToApp(applicationId: string, status: string, reference?: string, transactionId?: string) {
  const params = new URLSearchParams({ status });
  if (reference) params.set('reference', reference);
  if (transactionId) params.set('transactionId', transactionId);
  return NextResponse.redirect(`paymaxrn://registration/${applicationId}/payment-processing?${params.toString()}`);
}

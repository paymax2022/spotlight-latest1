import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  getRegistrationDraft,
  getRegistrationPaymentIntentByReference,
  markRegistrationPaymentIntentStatus,
  applyRegistrationPaymentSuccess,
} from '@/src/server/registration/supabase-store';

// Verifies a registration fee payment against Paystack's real verify API
// (test mode) — never trusts the client's own account of what happened.
// Idempotent: an already-completed intent (or a re-check while still
// pending) returns its settled status without re-charging or re-verifying
// Paystack unnecessarily.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);

    const limited = checkRateLimit(`registration:payment-verify:${user.id}`, 20, 60_000);
    if (!limited.allowed) return errorResponse('Too many verification attempts. Please slow down.', 429);

    const draft = await getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    const { searchParams } = new URL(request.url);
    const reference = searchParams.get('reference') || '';
    if (!reference) return errorResponse('reference is required.', 400);

    const intent = getRegistrationPaymentIntentByReference(reference);
    if (!intent || intent.applicationId !== params.id || intent.userId !== user.id) {
      return errorResponse('Payment intent not found.', 404);
    }

    if (intent.status === 'completed') {
      return NextResponse.json({ success: true, status: 'SUCCESSFUL', reference });
    }
    if (intent.status === 'failed') {
      return NextResponse.json({ success: true, status: 'FAILED', reference });
    }

    const verification = await verifyPaystackPayment(reference);
    if (!verification.success) {
      // Paystack settles quickly but isn't instant — a not-yet-successful
      // verify while still pending is reported as PENDING (client keeps
      // polling), not a hard failure. Only mark FAILED on a definitive
      // Paystack failure status, which verifyPaystackPayment folds into the
      // same `success: false` shape — safe default is to keep polling rather
      // than prematurely fail a payment still in flight.
      return NextResponse.json({ success: true, status: 'PENDING', reference });
    }

    if (verification.amountKobo < intent.amountKobo) {
      markRegistrationPaymentIntentStatus(intent.id, 'failed', 'Paystack amount is lower than the registration fee.');
      return NextResponse.json({ success: true, status: 'FAILED', reference });
    }

    applyRegistrationPaymentSuccess(params.id, { reference, method: 'PAYSTACK' });
    markRegistrationPaymentIntentStatus(intent.id, 'completed');

    return NextResponse.json({ success: true, status: 'SUCCESSFUL', reference });
  } catch (error) {
    return handleApiError(error, 'Failed to verify registration payment');
  }
}

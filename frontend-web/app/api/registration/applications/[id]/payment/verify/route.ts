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
//
// Exposed as BOTH GET and POST over one shared handler. The mobile app polls
// this via POST with a JSON body ({ reference }) — see
// mobile-app/.../registration.api.ts verifyRegistrationPayment — while the
// Paystack callback and web resolver reach it via GET with ?reference=. When
// only GET existed, the mobile POST got Next.js's automatic 405, which the
// client's poll loop swallowed as "still processing", so a payment Paystack had
// already captured never completed on-device. Both verbs must run the exact
// same verification, so it lives in verifyPayment() below.
async function verifyPayment(request: Request, id: string, reference: string) {
  try {
    const { user } = await requireUser(request);

    const limited = checkRateLimit(`registration:payment-verify:${user.id}`, 20, 60_000);
    if (!limited.allowed) return errorResponse('Too many verification attempts. Please slow down.', 429);

    const draft = await getRegistrationDraft(id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);

    if (!reference) return errorResponse('reference is required.', 400);

    const intent = await getRegistrationPaymentIntentByReference(reference);
    if (!intent || intent.applicationId !== id) {
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
      await markRegistrationPaymentIntentStatus(intent.id, 'failed', 'Paystack amount is lower than the registration fee.');
      return NextResponse.json({ success: true, status: 'FAILED', reference });
    }

    await applyRegistrationPaymentSuccess(id, { reference, method: 'PAYSTACK' });
    await markRegistrationPaymentIntentStatus(intent.id, 'completed');

    return NextResponse.json({ success: true, status: 'SUCCESSFUL', reference });
  } catch (error) {
    return handleApiError(error, 'Failed to verify registration payment');
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const reference = new URL(request.url).searchParams.get('reference') || '';
  return verifyPayment(request, id, reference);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Reading the JSON body does not consume the Authorization header, so
  // requireUser() inside verifyPayment still authenticates normally.
  const body = await request.json().catch(() => ({}));
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
  return verifyPayment(request, id, reference);
}

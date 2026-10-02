/**
 * POST /api/v1/payments/gateway/recover — verify-on-read self-heal for
 * Paystack gateway charges (AUD-FE-004 residual).
 *
 * paymax_gateway charges are client-initialized: if the client crashed between
 * Paystack collecting and the domain verify call, AND the webhook also failed,
 * the payment was verified-but-never-fulfilled with no way back. This endpoint
 * re-drives fulfilment by reference: it asks Paystack (the authority — never
 * the caller's claim) and settles every matching pending record through the
 * SAME shared fulfilment the webhook runs (src/server/payments/gateway-fulfil.ts),
 * so it is idempotent and safe to retry or to race with a webhook redelivery.
 *
 * It only ever fulfils records owned by whoever paid — it cannot move money to
 * the caller, so it grants no privilege beyond what the domain verify
 * endpoints already expose. Auth + rate limit still apply to keep the
 * provider-verify call from being a free oracle.
 *
 * Body: { reference: string }
 * Returns: { success, reference, verified, fulfilled: string[] }
 */
import { NextResponse } from 'next/server';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  findGatewayFulfilmentTargets,
  fulfilVerifiedGatewayCharge,
} from '@/src/server/payments/gateway-fulfil';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const limited = checkRateLimit(`gateway:recover:${user.id}`, 10, 60_000);
    if (!limited.allowed) {
      return errorResponse('Too many recovery attempts. Please slow down.', 429);
    }

    const body = (await request.json().catch(() => ({}))) as { reference?: unknown };
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) return errorResponse('reference is required', 400);

    // Paystack's verify API is the authority — the caller's claim that a charge
    // succeeded is never taken on trust.
    const verified = await verifyPaystackPayment(reference);
    if (!verified.success) {
      return NextResponse.json({ success: true, reference, verified: false, fulfilled: [] });
    }

    const targets = await findGatewayFulfilmentTargets(reference);
    const outcome = await fulfilVerifiedGatewayCharge(
      reference,
      verified.amountKobo,
      targets,
      verified.metadata,
    );
    if (outcome.error) {
      return errorResponse(outcome.error, 500);
    }

    return NextResponse.json({
      success: true,
      reference,
      verified: true,
      fulfilled: outcome.fulfilled,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

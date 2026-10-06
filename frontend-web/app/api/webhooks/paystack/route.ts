import { verifyPaystackWebhookSignature } from '@/src/server/voting/payment/paystack';
import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';
import { handleUtilityPaystackWebhook } from './utility-handler';
import { handleBankTransferWebhook } from '@/src/server/transfers/bank-webhook';
import { handleGatewayPaystackWebhook } from './gateway-handler';
import { forwardGoOwnedPaystackEvent } from './go-forward';

// Paystack sends all events to one URL. Each handler is responsible for:
//   1. Re-verifying the signature independently
//   2. Deciding if the event is relevant (by type/channel/metadata)
//   3. Deduplicating independently
// Promise.allSettled ensures all handlers run even if one throws.
// The seventh entry forwards Go-exclusive events (feespay:/foodorder:/
// rideorder:/duespay:) to the Go receiver — see go-forward.ts (AUD-INFRA-010).
export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  // 1. The HMAC is verified over the raw body BEFORE any handler dispatches or
  //    go-forward relays. Until now each handler verified independently — which
  //    meant forwardGoOwnedPaystackEvent sent Go-owned references (feespay:/
  //    foodorder:/rideorder:/duespay:) to the internal Go receiver with only
  //    the prefix as the claim signal. A junk-signed payload carrying one of
  //    those prefixes was forwarded, rejected there, and surfaced here as a
  //    500: a 500-vs-200 differential that leaked which prefixes Go owns, plus
  //    an unauthenticated internal-forward primitive. A bad signature is now a
  //    uniform 401 no matter what the body claims.
  let signatureValid = false;
  try {
    signatureValid = verifyPaystackWebhookSignature(rawBody, signature);
  } catch (err) {
    // No PAYSTACK_SECRET_KEY — nothing downstream can verify either, so the
    // delivery is unprocessable server-side rather than a client error.
    console.error('[webhook] paystack signature verification unavailable:', err);
    return Response.json(
      { received: false, processed: false, error: 'signature verification unavailable' },
      { status: 500 },
    );
  }
  if (!signatureValid) {
    return Response.json(
      { received: false, processed: false, error: 'invalid signature' },
      { status: 401 },
    );
  }

  // 2. Malformed bodies are refused before dispatch. JSON.parse('null')
  //    SUCCEEDS and then TypeErrors on property access inside the handlers
  //    (go-forward.ts hit exactly that on a literal `null` body), surfacing as
  //    a retryable 500 — Paystack would redeliver the garbage forever. Only a
  //    non-null object can be an event; anything else is a 400.
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    event = null;
  }
  if (event === null || typeof event !== 'object') {
    return Response.json(
      { received: false, processed: false, error: 'malformed body' },
      { status: 400 },
    );
  }

  const results = await Promise.allSettled([
    handlePaystackWebhook(rawBody, signature),
    handleWalletTopupWebhook(rawBody, signature),
    handleDvaTransferWebhook(rawBody, signature),
    handleUtilityPaystackWebhook(rawBody, signature),
    handleBankTransferWebhook(rawBody, signature),
    handleGatewayPaystackWebhook(rawBody, signature),
    forwardGoOwnedPaystackEvent(rawBody, signature),
  ]);

  const settled = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { processed: false, duplicate: false },
  );

  // AUD-REL-002: the old "always 200" meant a handler that THREW (bug, DB
  // down, provider timeout) was acked to Paystack and dropped forever — no
  // retry, no dead-letter. Handlers return {processed:false} for irrelevant
  // events and only reject on real failure, so a rejection is retryable:
  //   - SOME rejected → 500 (Paystack retries; each handler is idempotent, so
  //     redelivery is safe for the ones that already ran)
  //   - ALL rejected  → 400 (every handler threw on the same payload —
  //     malformed body; retrying garbage is pointless)
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error('[webhook] paystack handler rejected:', r.reason);
    }
    const status = rejected.length === results.length ? 400 : 500;
    return Response.json(
      { received: true, processed: false, error: 'handler failure' },
      { status },
    );
  }

  return Response.json(
    {
      received:  true,
      duplicate: settled.some((r) => r.duplicate),
      processed: settled.some((r) => r.processed),
    },
    { status: 200 },
  );
}

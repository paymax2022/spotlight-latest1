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

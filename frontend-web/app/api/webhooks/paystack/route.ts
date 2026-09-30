import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';
import { handleUtilityPaystackWebhook } from './utility-handler';
import { handleBankTransferWebhook } from '@/src/server/transfers/bank-webhook';
import { handleGatewayPaystackWebhook } from './gateway-handler';

// Paystack sends all events to one URL. Each handler is responsible for:
//   1. Re-verifying the signature independently
//   2. Deciding if the event is relevant (by type/channel/metadata)
//   3. Deduplicating independently
// Promise.allSettled ensures all handlers run even if one throws.
export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  const [voteResult, walletResult, dvaResult, utilityResult, bankResult, gatewayResult] = await Promise.allSettled([
    handlePaystackWebhook(rawBody, signature),
    handleWalletTopupWebhook(rawBody, signature),
    handleDvaTransferWebhook(rawBody, signature),
    handleUtilityPaystackWebhook(rawBody, signature),
    handleBankTransferWebhook(rawBody, signature),
    handleGatewayPaystackWebhook(rawBody, signature),
  ]);

  const vote    = voteResult.status    === 'fulfilled' ? voteResult.value    : { processed: false, duplicate: false };
  const wallet  = walletResult.status  === 'fulfilled' ? walletResult.value  : { processed: false, duplicate: false };
  const dva     = dvaResult.status     === 'fulfilled' ? dvaResult.value     : { processed: false, duplicate: false };
  const utility = utilityResult.status === 'fulfilled' ? utilityResult.value : { processed: false, duplicate: false };
  const bank    = bankResult.status    === 'fulfilled' ? bankResult.value    : { processed: false, duplicate: false };
  const gateway = gatewayResult.status === 'fulfilled' ? gatewayResult.value : { processed: false, duplicate: false };

  // AUD-REL-002: the old "always 200" meant a handler that THREW (bug, DB
  // down, provider timeout) was acked to Paystack and dropped forever — no
  // retry, no dead-letter. Handlers return {processed:false} for irrelevant
  // events and only reject on real failure, so a rejection is retryable:
  //   - SOME rejected → 500 (Paystack retries; each handler is idempotent, so
  //     redelivery is safe for the ones that already ran)
  //   - ALL rejected  → 400 (every handler threw on the same payload —
  //     malformed body; retrying garbage is pointless)
  const rejected = [voteResult, walletResult, dvaResult, utilityResult, bankResult, gatewayResult]
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected.length > 0) {
    for (const r of rejected) {
      console.error('[webhook] paystack handler rejected:', r.reason);
    }
    const status = rejected.length === 6 ? 400 : 500;
    return Response.json(
      { received: true, processed: false, error: 'handler failure' },
      { status },
    );
  }

  return Response.json(
    {
      received:  true,
      duplicate: vote.duplicate || wallet.duplicate || dva.duplicate || utility.duplicate || bank.duplicate || gateway.duplicate,
      processed: vote.processed || wallet.processed || dva.processed || utility.processed || bank.processed || gateway.processed,
    },
    { status: 200 },
  );
}

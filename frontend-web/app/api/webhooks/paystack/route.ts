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

  // Always return 200 to Paystack — a non-200 causes retries.
  return Response.json(
    {
      received:  true,
      duplicate: vote.duplicate || wallet.duplicate || dva.duplicate || utility.duplicate || bank.duplicate || gateway.duplicate,
      processed: vote.processed || wallet.processed || dva.processed || utility.processed || bank.processed || gateway.processed,
    },
    { status: 200 },
  );
}

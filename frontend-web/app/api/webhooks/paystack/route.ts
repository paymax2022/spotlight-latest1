import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';

// Paystack sends all events to one URL. Each handler is responsible for:
//   1. Re-verifying the signature independently
//   2. Deciding if the event is relevant (by type/channel/metadata)
//   3. Deduplicating independently
// Promise.allSettled ensures all handlers run even if one throws.
export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  const [voteResult, walletResult, dvaResult] = await Promise.allSettled([
    handlePaystackWebhook(rawBody, signature),
    handleWalletTopupWebhook(rawBody, signature),
    handleDvaTransferWebhook(rawBody, signature),
  ]);

  const vote = voteResult.status === 'fulfilled' ? voteResult.value : { processed: false, duplicate: false };
  const wallet = walletResult.status === 'fulfilled' ? walletResult.value : { processed: false, duplicate: false };
  const dva = dvaResult.status === 'fulfilled' ? dvaResult.value : { processed: false, duplicate: false };

  // Always return 200 to Paystack — a non-200 causes retries.
  return Response.json(
    {
      received: true,
      duplicate: vote.duplicate || wallet.duplicate || dva.duplicate,
      processed: vote.processed || wallet.processed || dva.processed,
    },
    { status: 200 },
  );
}

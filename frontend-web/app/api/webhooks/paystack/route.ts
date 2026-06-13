import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';

// Paystack sends webhook as application/json with x-paystack-signature header.
// Dispatch to both the voting handler and the wallet topup handler in parallel;
// each handler deduplicates independently and ignores events not meant for it.
export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  const [voteResult, walletResult] = await Promise.allSettled([
    handlePaystackWebhook(rawBody, signature),
    handleWalletTopupWebhook(rawBody, signature),
  ]);

  const vote = voteResult.status === 'fulfilled' ? voteResult.value : { processed: false, duplicate: false };
  const wallet = walletResult.status === 'fulfilled' ? walletResult.value : { processed: false, duplicate: false };

  // Always return 200 to Paystack — a non-200 causes retries.
  return Response.json(
    {
      received: true,
      duplicate: vote.duplicate || wallet.duplicate,
      processed: vote.processed || wallet.processed,
    },
    { status: 200 },
  );
}

import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';

// Paystack sends webhook as application/json with x-paystack-signature header.
// Never call verify() from here — the webhook handler is the authoritative path.
export async function POST(request: Request) {
  const signature = request.headers.get('x-paystack-signature') || '';
  const rawBody = await request.text();

  const result = await handlePaystackWebhook(rawBody, signature);

  // Always return 200 to Paystack — a non-200 causes retries.
  // Log errors internally; don't surface them to the provider.
  return Response.json(
    {
      received: true,
      duplicate: result.duplicate,
      processed: result.processed,
    },
    { status: 200 },
  );
}

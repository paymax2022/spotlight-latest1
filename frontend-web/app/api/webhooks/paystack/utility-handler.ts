import { verifyUtilityPaystackPayment } from '../../v1/utility/paystack/_service';
import { verifyHmacSha512Hex } from '@/src/lib/crypto/hmac';

interface UtilityPaystackWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

export async function handleUtilityPaystackWebhook(
  rawBody: string,
  signature: string,
): Promise<UtilityPaystackWebhookResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { processed: false, duplicate: false, error: 'Paystack not configured' };

  // Constant-time compare — `expected !== signature` leaks prefix-match timing.
  if (!verifyHmacSha512Hex(rawBody, signature, secretKey)) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    data?: {
      reference?: string;
      metadata?: { type?: string };
    };
  };

  if (event.event !== 'charge.success') return { processed: false, duplicate: false };
  if (event.data?.metadata?.type !== 'utility_payment') return { processed: false, duplicate: false };

  const reference = event.data.reference;
  if (!reference) return { processed: false, duplicate: false, error: 'Missing reference' };

  // A failure inside verifyUtilityPaystackPayment (DB flap, Paystack API
  // timeout) MUST propagate — swallowing it here ACKs the delivery to Paystack
  // and fulfilment then depends solely on the customer's browser poll. The
  // route maps a rejected promise to a 500 so Paystack redelivers; the
  // transaction-key dedupe makes redelivery safe.
  const result = await verifyUtilityPaystackPayment(reference);
  return { processed: !result.alreadyProcessed, duplicate: result.alreadyProcessed };
}

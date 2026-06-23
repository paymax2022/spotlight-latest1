import crypto from 'node:crypto';
import { verifyUtilityPaystackPayment } from '../../v1/utility/paystack/_service';

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

  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  if (expected !== signature) {
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

  try {
    const result = await verifyUtilityPaystackPayment(reference);
    return { processed: !result.alreadyProcessed, duplicate: result.alreadyProcessed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { processed: false, duplicate: false, error: message };
  }
}

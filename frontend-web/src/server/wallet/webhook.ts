import crypto from 'node:crypto';
import { findTopupIntent, settleTopupIntent } from './settle';

interface WalletWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

/**
 * Handle Paystack webhook events for wallet topup.
 * Called in parallel with the voting webhook handler — each dedupes independently.
 *
 * Dedup strategy: wallet_topup_intents.status. If the intent is already 'completed',
 * this is a duplicate webhook retry — safe to ignore.
 */
export async function handleWalletTopupWebhook(
  rawBody: string,
  signature: string,
): Promise<WalletWebhookResult> {
  // Verify signature independently
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return { processed: false, duplicate: false, error: 'Paystack not configured' };

  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  if (expected !== signature) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    data: {
      reference: string;
      amount: number;
      metadata?: { type?: string; topup_intent_id?: string; user_id?: string };
    };
  };

  // Only handle charge.success
  if (event.event !== 'charge.success') {
    return { processed: false, duplicate: false };
  }

  const metadata = event.data?.metadata;

  // Only handle wallet_topup events (identified by metadata.type)
  if (metadata?.type !== 'wallet_topup') {
    return { processed: false, duplicate: false };
  }

  const reference = event.data?.reference;
  if (!reference) return { processed: false, duplicate: false, error: 'Missing reference' };

  // Settlement itself lives in ./settle, shared with the verify-on-read fallback
  // (src/server/wallet/verify.ts). Both derive the ledger idempotency key from
  // the intent id, so a webhook and a verify racing the same payment credit it
  // exactly once.
  const intent = await findTopupIntent(reference);
  if (!intent) {
    // No matching intent — not our event
    return { processed: false, duplicate: false };
  }

  if (intent.status === 'completed') {
    return { processed: false, duplicate: true };
  }

  // Credit what Paystack actually collected, not what the intent hoped for. The
  // handler used to read `amount` off the event and never compare it, so any
  // divergence between the initialized amount and the settled one would be
  // credited at the intent's figure. Every module checkout now funds itself
  // through this path, so a mismatch here would mint wallet balance.
  const result = await settleTopupIntent(intent, Number(event.data?.amount ?? 0), reference);

  if (!result.settled) {
    return { processed: false, duplicate: false, error: result.error };
  }
  return { processed: !result.alreadySettled, duplicate: result.alreadySettled };
}

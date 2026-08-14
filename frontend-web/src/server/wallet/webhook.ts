import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet } from './service';
import { buildIdempotencyKey } from './ledger';

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

  const supabase = createAdminClient();

  // Find the matching topup intent
  const { data: intent } = await supabase
    .from('wallet_topup_intents')
    .select('id, user_id, amount_kobo, status')
    .eq('payment_reference', reference)
    .maybeSingle();

  if (!intent) {
    // No matching intent — not our event
    return { processed: false, duplicate: false };
  }

  // Idempotency: already credited
  if (intent.status === 'completed') {
    return { processed: false, duplicate: true };
  }

  // Credit what Paystack actually collected, not what the intent hoped for.
  // The handler used to read `amount` off the event and never compare it, so any
  // divergence between the initialized amount and the settled one would be
  // credited at the intent's figure. Every module checkout now funds itself
  // through this path, so a mismatch here would mint wallet balance.
  const paidKobo = Number(event.data?.amount ?? 0);
  const intentKobo = Number(intent.amount_kobo ?? 0);
  if (!Number.isInteger(paidKobo) || paidKobo !== intentKobo) {
    const message = `Amount mismatch for ${reference}: charged ${paidKobo} kobo, intent expects ${intentKobo} kobo`;
    await supabase
      .from('wallet_topup_intents')
      .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .eq('id', intent.id);
    return { processed: false, duplicate: false, error: message };
  }

  try {
    const idempotencyKey = buildIdempotencyKey('topup', intent.id as string, 'CREDIT');

    await creditWallet(intent.user_id as string, {
      amountKobo: intent.amount_kobo as number,
      reference: `TOPUP:${reference}`,
      idempotencyKey,
      description: 'Wallet top-up via Paystack',
      metadata: { payment_reference: reference, topup_intent_id: intent.id },
    });

    await supabase
      .from('wallet_topup_intents')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    return { processed: true, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from('wallet_topup_intents')
      .update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    return { processed: false, duplicate: false, error: message };
  }
}

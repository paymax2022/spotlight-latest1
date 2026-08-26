import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet } from './service';
import { buildIdempotencyKey } from './ledger';

/**
 * The one place a wallet top-up is settled.
 *
 * Two callers reach it: the Paystack webhook, and the verify-on-read fallback
 * used when that webhook is late or never arrives. Both must apply exactly the
 * same rules — an amount check, a status check, one idempotent credit — because
 * a second settlement path with its own logic is how the same payment ends up
 * credited twice.
 *
 * They are safe to race. The ledger idempotency key is derived from the intent
 * id, so whichever path arrives second produces the same key and postJournal's
 * UNIQUE constraint turns it into a no-op.
 */

export interface TopupIntent {
  id: string;
  user_id: string;
  amount_kobo: number;
  status: string;
}

export interface SettlementResult {
  settled: boolean;
  alreadySettled: boolean;
  error?: string;
}

/** Loads an intent by its Paystack reference. Returns null when unknown. */
export async function findTopupIntent(reference: string): Promise<TopupIntent | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('wallet_topup_intents')
    .select('id, user_id, amount_kobo, status')
    .eq('payment_reference', reference)
    .maybeSingle();
  return (data as TopupIntent | null) ?? null;
}

async function markIntent(id: string, values: Record<string, unknown>): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from('wallet_topup_intents')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Credits the wallet for a top-up that a payment authority has confirmed as
 * collected. `paidKobo` is what was ACTUALLY collected — never what the intent
 * hoped for — so a divergence is caught here instead of minting balance.
 */
export async function settleTopupIntent(
  intent: TopupIntent,
  paidKobo: number,
  reference: string,
): Promise<SettlementResult> {
  // Already money in the wallet. Not an error — the caller asked for the intent
  // to be settled and it is.
  if (intent.status === 'completed') {
    return { settled: true, alreadySettled: true };
  }

  const intentKobo = Number(intent.amount_kobo ?? 0);
  if (!Number.isInteger(paidKobo) || paidKobo !== intentKobo) {
    const error = `Amount mismatch for ${reference}: charged ${paidKobo} kobo, intent expects ${intentKobo} kobo`;
    await markIntent(intent.id, { status: 'failed', error_message: error });
    return { settled: false, alreadySettled: false, error };
  }

  try {
    await creditWallet(intent.user_id, {
      amountKobo: intentKobo,
      reference: `TOPUP:${reference}`,
      idempotencyKey: buildIdempotencyKey('topup', intent.id, 'CREDIT'),
      description: 'Wallet top-up via Paystack',
      metadata: { payment_reference: reference, topup_intent_id: intent.id },
    });

    await markIntent(intent.id, { status: 'completed' });
    return { settled: true, alreadySettled: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await markIntent(intent.id, { status: 'failed', error_message: error });
    return { settled: false, alreadySettled: false, error };
  }
}

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet, resolveBillingEmail } from './service';
import { buildIdempotencyKey } from './ledger';
import { topupDescription } from './checkout-domain';
import { notifyTopupFailed, notifyTopupSuccess } from './notifications';

/**
 * WAL-002: best-effort, fire-and-forget — a notification failure (or a user
 * with no valid billable email) must never affect settlement, which is why
 * this is called after `markIntent` and never awaited by its caller.
 */
async function notifySettlementOutcome(
  intent: TopupIntent,
  reference: string,
  outcome: { success: true } | { success: false; reason: string },
): Promise<void> {
  try {
    const to = await resolveBillingEmail(intent.user_id, '');
    if (outcome.success) {
      notifyTopupSuccess({ to, amountKobo: Number(intent.amount_kobo ?? 0), reference });
    } else {
      notifyTopupFailed({ to, amountKobo: Number(intent.amount_kobo ?? 0), reference, reason: outcome.reason });
    }
  } catch (err) {
    // resolveBillingEmail throws when the user has no valid billable email —
    // not an error worth logging loudly, just skip the notification.
    console.error('[wallet-email] skipped topup notification:', err instanceof Error ? err.message : err);
  }
}

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
  /** What the checkout was buying; NULL for standalone wallet funding. */
  checkout_domain?: string | null;
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
    .select('id, user_id, amount_kobo, status, checkout_domain')
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
    void notifySettlementOutcome(intent, reference, { success: false, reason: error });
    return { settled: false, alreadySettled: false, error };
  }

  try {
    await creditWallet(intent.user_id, {
      amountKobo: intentKobo,
      reference: `TOPUP:${reference}`,
      // MUST stay exactly this. The key is the only thing preventing a webhook
      // and a verify from crediting the same payment twice, and changing its
      // shape would make every in-flight retry look like a new credit.
      idempotencyKey: buildIdempotencyKey('topup', intent.id, 'CREDIT'),
      // Says what the money bought, so a statement can tell a vote purchase from
      // a food order from a plain top-up.
      description: topupDescription(intent.checkout_domain),
      metadata: {
        payment_reference: reference,
        topup_intent_id: intent.id,
        checkout_domain: intent.checkout_domain ?? null,
      },
    });

    await markIntent(intent.id, { status: 'completed' });
    void notifySettlementOutcome(intent, reference, { success: true });
    return { settled: true, alreadySettled: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await markIntent(intent.id, { status: 'failed', error_message: error });
    void notifySettlementOutcome(intent, reference, { success: false, reason: error });
    return { settled: false, alreadySettled: false, error };
  }
}

/**
 * Reconciliation sweep for Paystack gateway charges (AUD-FE-003 residual).
 *
 * Webhooks can be missed entirely (dropped delivery, handler outage) and
 * client verify callbacks are best-effort — either way a *collected* charge
 * can sit unfulfilled. Every server-initiated checkout now leaves a pending
 * record keyed by the charge reference (vote_transactions,
 * registration_payment_intents, openmic_vote_paystack_intents), so this sweep
 * walks those pending rows, asks Paystack (the authority) whether the charge
 * succeeded, and re-drives the same fulfilment the webhook runs.
 *
 * Backstop, not primary path: it only considers rows inside a sliding window
 * — older than `graceMs` (let the normal paths win first) and younger than
 * `maxAgeMs` (abandoned checkouts would otherwise be re-verified forever).
 * Failed fulfils stay pending and are retried on the next sweep; the fulfil
 * arms are all idempotent.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  findGatewayFulfilmentTargets,
  fulfilVerifiedGatewayCharge,
} from '@/src/server/payments/gateway-fulfil';

export interface GatewayReconcileOptions {
  /** Per-table scan cap. */
  limit: number;
  /** Ignore rows newer than this — let webhook/verify settle first. */
  graceMs: number;
  /** Ignore rows older than this — abandoned checkouts, never paid. */
  maxAgeMs: number;
}

export interface GatewayReconcileResult {
  scanned: number;
  verified: number;
  fulfilled: string[];
  /** References whose fulfilment threw — retryable on the next sweep. */
  failed: { reference: string; error: string }[];
}

const DEFAULTS: GatewayReconcileOptions = {
  limit: 25,
  graceMs: 2 * 60 * 1000,       // 2 minutes
  maxAgeMs: 24 * 60 * 60 * 1000 // 24 hours
};

async function pendingReferences(
  opts: GatewayReconcileOptions,
): Promise<string[]> {
  const supabase = createAdminClient();
  const newest = new Date(Date.now() - opts.graceMs).toISOString();
  const oldest = new Date(Date.now() - opts.maxAgeMs).toISOString();

  const [voteTxs, regIntents, omIntents] = await Promise.all([
    supabase
      .from('vote_transactions')
      .select('payment_reference')
      .eq('vote_credit_status', 'pending')
      .lt('created_at', newest)
      .gt('created_at', oldest)
      .limit(opts.limit),
    supabase
      .from('registration_payment_intents')
      .select('reference')
      .in('status', ['initiated', 'verified'])
      .lt('created_at', newest)
      .gt('created_at', oldest)
      .limit(opts.limit),
    supabase
      .from('openmic_vote_paystack_intents')
      .select('reference')
      .eq('status', 'pending')
      .lt('created_at', newest)
      .gt('created_at', oldest)
      .limit(opts.limit),
  ]);

  for (const r of [voteTxs, regIntents, omIntents]) {
    if (r.error) throw r.error;
  }

  const refs = [
    ...(voteTxs.data ?? []).map((r) => (r as { payment_reference: string }).payment_reference),
    ...(regIntents.data ?? []).map((r) => (r as { reference: string }).reference),
    ...(omIntents.data ?? []).map((r) => (r as { reference: string }).reference),
  ];
  return [...new Set(refs)];
}

export async function sweepGatewayIntents(
  opts: Partial<GatewayReconcileOptions> = {},
): Promise<GatewayReconcileResult> {
  const options = { ...DEFAULTS, ...opts };
  const references = await pendingReferences(options);

  const result: GatewayReconcileResult = {
    scanned: references.length,
    verified: 0,
    fulfilled: [],
    failed: [],
  };

  for (const reference of references) {
    try {
      // Paystack is the authority — a pending row whose charge never completed
      // (abandoned checkout) verifies false and is skipped, left to age out of
      // the sweep window rather than being marked failed on the provider's
      // transient answer.
      const verified = await verifyPaystackPayment(reference);
      if (!verified.success) continue;
      result.verified += 1;

      const targets = await findGatewayFulfilmentTargets(reference);
      const outcome = await fulfilVerifiedGatewayCharge(
        reference,
        verified.amountKobo,
        targets,
        verified.metadata,
      );
      if (outcome.error) {
        result.failed.push({ reference, error: outcome.error });
        continue;
      }
      result.fulfilled.push(...outcome.fulfilled);
    } catch (err) {
      result.failed.push({
        reference,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

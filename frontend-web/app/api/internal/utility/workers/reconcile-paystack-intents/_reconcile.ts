import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { verifyUtilityPaystackPayment } from '@/app/api/v1/utility/paystack/_service';

// Younger than this, the webhook, the browser callback and the app's own poll
// still get the first go at the intent.
const MIN_AGE_MS = 10 * 60 * 1000;
// Older than this, an unpaid checkout is abandoned and stops being polled.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type IntentOutcome = 'completed' | 'already_processed' | 'unpaid' | 'error';

export type ReconcileResult = {
  processed: number;
  completed: number;
  alreadyProcessed: number;
  unpaid: number;
  errors: number;
  results: Array<{ id: string; reference: string; outcome: IntentOutcome }>;
};

/**
 * Finds utility Paystack intents still `pending` and runs the paid ones through
 * the same idempotent verify-and-vend path the webhook uses, so a payment whose
 * webhook never landed is still fulfilled (or refunded on a validation failure).
 *
 * An unpaid intent is deliberately left alone: verifyUtilityPaystackPayment
 * marks an unsuccessful charge `failed`, and a customer may still be completing
 * checkout.
 */
export async function reconcileUtilityPaystackIntents(
  opts: { limit?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  const { data, error } = await createAdminClient()
    .from('utility_paystack_intents')
    .select('id, payment_reference')
    .eq('status', 'pending')
    .lt('created_at', new Date(now.getTime() - MIN_AGE_MS).toISOString())
    .gt('created_at', new Date(now.getTime() - MAX_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error('Failed to load pending utility Paystack intents.');

  const results: ReconcileResult['results'] = [];
  for (const row of (data ?? []) as Array<{ id: string; payment_reference: string }>) {
    const reference = row.payment_reference;
    try {
      const paid = await verifyPaystackPayment(reference);
      if (!paid.success) {
        results.push({ id: row.id, reference, outcome: 'unpaid' });
        continue;
      }
      const verified = await verifyUtilityPaystackPayment(reference);
      results.push({
        id: row.id,
        reference,
        outcome: verified.alreadyProcessed ? 'already_processed' : 'completed',
      });
    } catch (err) {
      // The error text can carry provider or PostgREST internals and this array
      // is returned to the scheduler, so log it here and report generically.
      console.error('[utility/reconcile] intent failed', reference, err instanceof Error ? err.message : err);
      results.push({ id: row.id, reference, outcome: 'error' });
    }
  }

  const count = (o: IntentOutcome) => results.filter((r) => r.outcome === o).length;
  return {
    processed: results.length,
    completed: count('completed'),
    alreadyProcessed: count('already_processed'),
    unpaid: count('unpaid'),
    errors: count('error'),
    results,
  };
}

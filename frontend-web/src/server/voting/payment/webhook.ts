import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackWebhookSignature, verifyPaystackPayment } from './paystack';
import { verifyAndCreditPaidVote } from '../paid-vote.service';
import { appendAuditLog } from '../audit.service';

interface WebhookHandleResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

// Idempotent handler — safe to call multiple times for the same event.
export async function handlePaystackWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookHandleResult> {
  // 1. Verify signature
  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    data: { reference: string; status: string; id: number; amount: number; metadata?: Record<string, unknown> };
  };

  const reference = event.data?.reference;
  if (!reference) return { processed: false, duplicate: false, error: 'Missing reference' };

  const supabase = createAdminClient();

  // 2. Idempotency — check if we already processed this event
  const { data: existing } = await supabase
    .from('payment_webhook_logs')
    .select('id, processed')
    .eq('reference', reference)
    .eq('provider', 'paystack')
    .eq('event_type', event.event)
    .maybeSingle();

  if (existing?.processed) {
    return { processed: false, duplicate: true };
  }

  // 3. Log the webhook (before processing so we don't miss it on error)
  const { data: logRow } = await supabase
    .from('payment_webhook_logs')
    .upsert(
      {
        provider: 'paystack',
        event_type: event.event,
        reference,
        payload: event as never,
        processed: false,
      },
      { onConflict: 'provider,reference,event_type', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  const logId = (logRow as { id?: string } | null)?.id;

  const markLogProcessed = async () => {
    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: true })
        .eq('id', logId);
    }
  };

  // 4a. Failed / abandoned charges — resolve stale 'pending' vote_transactions.
  // This is idempotent: we only flip a still-pending row to 'failed' and never
  // touch a row that already settled successfully/refunded.
  if (event.event === 'charge.failed' || event.event === 'charge.abandoned') {
    const { data: failedTx } = await supabase
      .from('vote_transactions')
      .select('id, payment_status')
      .eq('payment_reference', reference)
      .maybeSingle();

    const ft = failedTx as { id?: string; payment_status?: string } | null;
    if (ft?.id && ft.payment_status === 'pending') {
      await supabase
        .from('vote_transactions')
        .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', ft.id)
        // Guard against a concurrent success-credit: only flip if still pending.
        .eq('payment_status', 'pending');

      await appendAuditLog({
        actorId: 'system:webhook',
        actorRole: 'system',
        action: 'paid_vote_payment_failed',
        entityType: 'vote_transaction',
        entityId: ft.id,
        newValue: { event: event.event, reference, payment_status: 'failed' },
      });
    }

    await markLogProcessed();
    return { processed: true, duplicate: false };
  }

  // 4b. Only credit votes on charge.success; all other event types are logged
  // and acknowledged.
  if (event.event !== 'charge.success') {
    await markLogProcessed();
    return { processed: true, duplicate: false };
  }

  // 5. Find the matching vote transaction
  const { data: tx } = await supabase
    .from('vote_transactions')
    .select('id, contest_id, contestant_id')
    .eq('payment_reference', reference)
    .maybeSingle();

  if (!tx) {
    // Not a voting transaction — could be a different payment type; mark processed and exit.
    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: true })
        .eq('id', logId);
    }
    return { processed: true, duplicate: false };
  }

  // 6. Credit votes
  try {
    await verifyAndCreditPaidVote(
      { transactionId: tx.id, paymentReference: reference },
      'system:webhook',
      '0.0.0.0',
      'paystack-webhook',
    );

    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: true })
        .eq('id', logId);
    }

    return { processed: true, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await appendAuditLog({
      actorId: 'system:webhook',
      actorRole: 'system',
      action: 'webhook_vote_credit_failed',
      entityType: 'vote_transaction',
      entityId: tx.id,
      contestId: tx.contest_id,
      contestantId: tx.contestant_id,
      newValue: { error: message, reference },
    });

    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: false, error_message: message })
        .eq('id', logId);
    }

    return { processed: false, duplicate: false, error: message };
  }
}

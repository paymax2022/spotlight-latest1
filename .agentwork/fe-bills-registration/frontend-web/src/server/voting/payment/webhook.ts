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

  // 4. Only handle charge.success
  if (event.event !== 'charge.success') {
    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: true })
        .eq('id', logId);
    }
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

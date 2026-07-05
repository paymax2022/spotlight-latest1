import { createAdminClient } from '@/lib/supabase/server';
import {
  verifyPaystackWebhookSignature,
  verifyPaystackPayment,
} from '@/src/server/voting/payment/paystack';

// Webhook handler for the in-app Paystack gateway (the client-side Inline SDK
// used by the mobile food/voting checkouts). Those charges are created directly
// on Paystack from the client and tagged with `metadata.purpose = 'paymax_gateway'`.
//
// Because they are not server-initiated, this handler's job is to provide the
// server-authoritative half: re-verify the signature, independently confirm the
// charge with Paystack's verify API, and record it idempotently. It deliberately
// claims ONLY events carrying our gateway marker, so it never conflicts with the
// vote/wallet/utility handlers running alongside it.

interface GatewayWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

interface PaystackEvent {
  event: string;
  data?: {
    reference?: string;
    metadata?: { purpose?: string; domain?: string } & Record<string, unknown>;
  };
}

export async function handleGatewayPaystackWebhook(
  rawBody: string,
  signature: string,
): Promise<GatewayWebhookResult> {
  // 1. Signature
  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    return { processed: false, duplicate: false, error: 'Invalid signature' };
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody) as PaystackEvent;
  } catch {
    return { processed: false, duplicate: false, error: 'Invalid JSON' };
  }

  // 2. Only claim charges that originated from our in-app gateway.
  if (event.data?.metadata?.purpose !== 'paymax_gateway') {
    return { processed: false, duplicate: false };
  }

  const reference = event.data?.reference;
  if (!reference) return { processed: false, duplicate: false, error: 'Missing reference' };

  const domain = event.data?.metadata?.domain ?? 'unknown';
  const supabase = createAdminClient();

  // 3. Idempotency — skip if we already processed this exact event.
  const { data: existing } = await supabase
    .from('payment_webhook_logs')
    .select('id, processed')
    .eq('reference', reference)
    .eq('provider', 'paystack')
    .eq('event_type', event.event)
    .maybeSingle();

  if ((existing as { processed?: boolean } | null)?.processed) {
    return { processed: false, duplicate: true };
  }

  // 4. Log before processing so a mid-way error can be retried.
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
  const markProcessed = async (error?: string) => {
    if (logId) {
      await supabase
        .from('payment_webhook_logs')
        .update({ processed: !error, ...(error ? { error_message: error } : {}) })
        .eq('id', logId);
    }
  };

  // 5. Non-success events: acknowledge and record (nothing to fulfil).
  if (event.event !== 'charge.success') {
    await markProcessed();
    return { processed: true, duplicate: false };
  }

  // 6. Independently confirm the charge with Paystack (never trust the payload).
  try {
    const verified = await verifyPaystackPayment(reference);
    if (!verified.success) {
      await markProcessed(`Verification failed for ${reference}`);
      return { processed: false, duplicate: false, error: 'Verification failed' };
    }

    // Server-confirmed. The verified row in payment_webhook_logs is the audit +
    // reconciliation anchor for the domain (`${domain}`) fulfilment the client
    // performed on its success callback.
    // TODO: when food/voting move to server-initiated orders, look the pending
    // record up by `reference` here and settle it server-side.
    await markProcessed();
    return { processed: true, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProcessed(message);
    return { processed: false, duplicate: false, error: message };
  }
}

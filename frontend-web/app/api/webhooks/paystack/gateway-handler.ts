import { createAdminClient } from '@/lib/supabase/server';
import {
  verifyPaystackWebhookSignature,
  verifyPaystackPayment,
} from '@/src/server/voting/payment/paystack';
import {
  findVoteTransactionByReference,
  fulfilVerifiedGatewayCharge,
  isActionableRegistrationIntent,
} from '@/src/server/payments/gateway-fulfil';
import {
  getOpenMicVoteIntentByReference,
  type OpenMicVoteIntent,
} from '@/src/server/payments/openmic-vote-intents';
import {
  getAcademyFeeIntentByReference,
  type AcademyFeeIntent,
} from '@/src/server/payments/academy-fee-intents';
import {
  getRegistrationPaymentIntentByReference,
  type RegistrationPaymentIntent,
} from '@/src/server/registration/supabase-store';

// Webhook handler for Paystack gateway charges — both the in-app client-side
// Inline SDK (tagged `metadata.purpose = 'paymax_gateway'`) and server-initiated
// checkouts that leave a pending fulfilment record keyed by reference (e.g.
// registration_payment_intents, whose metadata is `type:'registration_payment'`
// rather than the gateway marker).
//
// This handler's job is the server-authoritative half: re-verify the signature,
// independently confirm the charge with Paystack's verify API, settle every
// matching pending record idempotently, and record the event. Domains with no
// server-side record keyed by reference stay client-verify-driven — see
// src/server/payments/gateway-fulfil.ts for which those are and why.

interface GatewayWebhookResult {
  processed: boolean;
  duplicate: boolean;
  error?: string;
}

interface PaystackEvent {
  event: string;
  data?: {
    reference?: string;
    metadata?: { purpose?: string; domain?: string; type?: string } & Record<string, unknown>;
  };
}

/**
 * AUD-FE-004 residual: this handler used to share ONE payment_webhook_logs row
 * with the vote handler (keyed provider+reference+event_type). For a
 * `paymax_gateway` charge.success both handlers run in the dispatcher's
 * parallel fan-out, and whichever marked `processed` first made the other
 * return `duplicate` and skip verification entirely. The vote handler file is
 * protected legacy, so the split happens on this side: the gateway handler
 * owns `gateway:<event>` rows, the vote handler keeps plain `<event>` rows,
 * and neither can consume the other's dedup record.
 */
function gatewayEventType(eventType: string): string {
  return `gateway:${eventType}`;
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

  const reference = event.data?.reference;
  const marked = event.data?.metadata?.purpose === 'paymax_gateway';

  // 2. Claim: the gateway marker, OR a charge.success whose reference resolves
  //    to a pending registration payment intent — server-initiated checkouts
  //    never carry the marker, and without this their only fulfilment path was
  //    the browser reaching the verify endpoint (AUD-FE-003 residual). A thrown
  //    lookup is left to reject the handler so the dispatcher 500s and Paystack
  //    retries, rather than silently dropping a charge we might own.
  let registrationIntent: RegistrationPaymentIntent | null = null;
  let openmicIntent: OpenMicVoteIntent | null = null;
  let academyIntent: AcademyFeeIntent | null = null;
  if (event.event === 'charge.success' && reference) {
    [registrationIntent, openmicIntent, academyIntent] = await Promise.all([
      getRegistrationPaymentIntentByReference(reference),
      getOpenMicVoteIntentByReference(reference),
      getAcademyFeeIntentByReference(reference),
    ]);
  }
  if (
    !marked &&
    !isActionableRegistrationIntent(registrationIntent) &&
    openmicIntent?.status !== 'pending' &&
    academyIntent?.status !== 'pending'
  ) {
    return { processed: false, duplicate: false };
  }

  if (!reference) return { processed: false, duplicate: false, error: 'Missing reference' };

  const supabase = createAdminClient();
  const scopedEventType = gatewayEventType(event.event);

  // 3. Idempotency — skip if we already processed this exact event under OUR
  //    scope (the vote handler's `charge.success` row no longer counts here).
  const { data: existing } = await supabase
    .from('payment_webhook_logs')
    .select('id, processed')
    .eq('reference', reference)
    .eq('provider', 'paystack')
    .eq('event_type', scopedEventType)
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
        event_type: scopedEventType,
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

  // 6. Independently confirm the charge with Paystack (never trust the payload),
  //    then settle every matching pending record through the shared fulfilment
  //    module — the same one POST /api/v1/payments/gateway/recover re-drives.
  try {
    const verified = await verifyPaystackPayment(reference);
    if (!verified.success) {
      await markProcessed(`Verification failed for ${reference}`);
      return { processed: false, duplicate: false, error: 'Verification failed' };
    }

    // Vote fulfilment stays scoped to marked charges: the (protected) vote
    // handler already owns unmarked charge.success vote crediting — this side
    // only adds the server-initiated domains it cannot see.
    const voteTransaction = marked ? await findVoteTransactionByReference(reference) : null;

    const outcome = await fulfilVerifiedGatewayCharge(
      reference,
      verified.amountKobo,
      {
        voteTransaction,
        registrationIntent,
        openmicIntent,
        academyIntent,
      },
      { providerReference: verified.providerReference, paidAt: verified.paidAt },
    );
    if (outcome.error) {
      await markProcessed(outcome.error);
      return { processed: false, duplicate: false, error: outcome.error };
    }

    await markProcessed();
    return { processed: true, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProcessed(message);
    return { processed: false, duplicate: false, error: message };
  }
}

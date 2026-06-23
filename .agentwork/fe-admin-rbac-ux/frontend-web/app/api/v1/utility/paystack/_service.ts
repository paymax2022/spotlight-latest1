import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { initializePaystackPayment, verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { payUtility, quoteUtilityPayment } from '@/src/server/utility/service';
import type { UtilityCategory } from '@/src/server/utility/types';

function reference() {
  return `UTIL_${crypto.randomUUID().replace(/-/g, '').slice(0, 18).toUpperCase()}`;
}

function appCallbackFallback(transactionId: string) {
  return `paymaxrn://services/receipt/${transactionId}`;
}

export async function initiateUtilityPaystackPayment(input: {
  request: Request;
  userId: string;
  email: string;
  category: UtilityCategory;
  billerId: string;
  productId: string;
  customerReference: string;
  amountKobo?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const supabase = createAdminClient();
  const existing = await supabase
    .from('utility_paystack_intents')
    .select('*')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing.data) {
    return {
      alreadyProcessed: true,
      intent: existing.data as Record<string, unknown>,
      authorizationUrl: String(existing.data.authorization_url ?? ''),
      paymentReference: String(existing.data.payment_reference ?? ''),
    };
  }

  const quote = await quoteUtilityPayment({
    category: input.category,
    billerId: input.billerId,
    productId: input.productId,
    amountKobo: input.amountKobo,
  });

  const paymentReference = reference();
  const intentId = crypto.randomUUID();
  const callbackUrl = new URL(`/api/v1/utility/paystack/callback?reference=${encodeURIComponent(paymentReference)}`, input.request.url).toString();

  const { error: insertError } = await supabase.from('utility_paystack_intents').insert({
    id: intentId,
    user_id: input.userId,
    category: input.category,
    biller_id: input.billerId,
    product_id: input.productId,
    customer_reference: input.customerReference,
    amount_kobo: quote.pricing.amountKobo,
    retail_amount_kobo: quote.pricing.retailAmountKobo,
    payment_reference: paymentReference,
    idempotency_key: input.idempotencyKey,
    status: 'pending',
    metadata: input.metadata ?? {},
  });

  if (insertError) throw new ApiError(`Failed to create Paystack utility intent: ${insertError.message}`, 500);

  const authorizationUrl = await initializePaystackPayment({
    reference: paymentReference,
    email: input.email,
    amount: quote.pricing.retailAmountKobo,
    currency: 'NGN',
    callbackUrl,
    metadata: {
      type: 'utility_payment',
      utility_intent_id: intentId,
      user_id: input.userId,
      category: input.category,
    },
  });

  await supabase
    .from('utility_paystack_intents')
    .update({ authorization_url: authorizationUrl, updated_at: new Date().toISOString() })
    .eq('id', intentId);

  return {
    alreadyProcessed: false,
    intent: { id: intentId, retail_amount_kobo: quote.pricing.retailAmountKobo },
    authorizationUrl,
    paymentReference,
  };
}

export async function verifyUtilityPaystackPayment(reference: string, userId?: string) {
  if (!reference) throw new ApiError('payment reference is required.', 400);

  const supabase = createAdminClient();
  let query = supabase
    .from('utility_paystack_intents')
    .select('*')
    .eq('payment_reference', reference);
  if (userId) query = query.eq('user_id', userId);

  const { data: intent, error } = await query.maybeSingle();
  if (error || !intent) throw new ApiError('Utility Paystack intent not found.', 404);

  if (intent.status === 'completed' && intent.transaction_id) {
    const { data: transaction } = await supabase.from('utility_transactions').select('*').eq('id', intent.transaction_id).maybeSingle();
    return { alreadyProcessed: true, transaction };
  }

  const verification = await verifyPaystackPayment(reference);
  if (!verification.success) {
    await supabase
      .from('utility_paystack_intents')
      .update({ status: 'failed', failure_reason: 'Paystack payment was not successful.', updated_at: new Date().toISOString() })
      .eq('id', intent.id);
    throw new ApiError('Paystack payment was not successful.', 400);
  }

  if (verification.amountKobo < Number(intent.retail_amount_kobo)) {
    await supabase
      .from('utility_paystack_intents')
      .update({ status: 'failed', failure_reason: 'Paystack amount is lower than utility amount.', updated_at: new Date().toISOString() })
      .eq('id', intent.id);
    throw new ApiError('Paystack amount is lower than utility amount.', 400);
  }

  const metadata = (typeof intent.metadata === 'object' && intent.metadata !== null ? intent.metadata : {}) as Record<string, unknown>;
  const result = await payUtility(String(intent.user_id), {
    category: intent.category as UtilityCategory,
    billerId: String(intent.biller_id),
    productId: String(intent.product_id),
    customerReference: String(intent.customer_reference),
    amountKobo: Number(intent.amount_kobo),
    paymentSource: 'paystack',
    idempotencyKey: `utility:paystack:${reference}`,
    metadata: {
      ...metadata,
      payment_reference: reference,
      paystack_provider_reference: verification.providerReference,
      payment_source: 'paystack',
    },
  });

  await supabase
    .from('utility_paystack_intents')
    .update({
      status: 'completed',
      transaction_id: result.transaction.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intent.id);

  return { alreadyProcessed: false, transaction: result.transaction };
}

export function redirectToApp(transactionId?: string) {
  return NextResponse.redirect(transactionId ? appCallbackFallback(transactionId) : 'paymaxrn://services/transactions');
}

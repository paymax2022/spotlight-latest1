/**
 * Reference-keyed pending record for Film Academy application-fee charges
 * (AUD-FE-003 residual).
 *
 * POST /api/academy/application-fee/initiate writes one row per minted
 * reference so a Paystack-verified charge can be settled even when the
 * client's application submit never arrives — the webhook gateway handler,
 * POST /api/v1/payments/gateway/recover, and the reconcile sweep all re-drive
 * fulfilment through src/server/payments/gateway-fulfil.ts.
 *
 * The row also freezes the SERVER-side quote (academy_settings.application_fee)
 * at charge time: fulfil and the apply route compare the confirmed amount
 * against amount_kobo, so a client-declared fee can no longer set the charge.
 *
 * Lifecycle: pending → paid (verified ≥ quote) | amount_mismatch | failed,
 * then paid → consumed once an academy_applications row takes the reference.
 * 'consumed' links intent → application; a second submit of the same
 * reference can never mint a second application off one charge.
 *
 * Stores no money state — academy_applications.payment_reference remains the
 * dedup anchor for the application itself.
 */
import { createAdminClient } from '@/lib/supabase/server';

export type AcademyFeeIntentStatus =
  | 'pending'
  | 'paid'
  | 'amount_mismatch'
  | 'failed'
  | 'consumed';

export interface AcademyFeeIntent {
  reference: string;
  user_id: string | null;
  email: string;
  full_name: string;
  batch_id: string | null;
  amount_kobo: number;
  verified_amount_kobo: number | null;
  provider_reference: string | null;
  application_id: string | null;
  status: AcademyFeeIntentStatus;
}

const INTENT_COLUMNS =
  'reference, user_id, email, full_name, batch_id, amount_kobo, verified_amount_kobo, provider_reference, application_id, status';

export async function createAcademyFeeIntent(input: {
  reference: string;
  userId?: string | null;
  email: string;
  fullName: string;
  batchId?: string | null;
  amountKobo: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();
  // upsert-ignore rather than insert: a retried initiate with the same
  // reference must not error, and must not overwrite the original quote.
  const { error } = await supabase
    .from('academy_application_fee_intents')
    .upsert(
      {
        reference: input.reference,
        user_id: input.userId ?? null,
        email: input.email,
        full_name: input.fullName,
        batch_id: input.batchId ?? null,
        amount_kobo: input.amountKobo,
        status: 'pending',
        metadata: input.metadata ?? null,
      },
      { onConflict: 'reference', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function getAcademyFeeIntentByReference(
  reference: string,
): Promise<AcademyFeeIntent | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_application_fee_intents')
    .select(INTENT_COLUMNS)
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  return (data as AcademyFeeIntent | null) ?? null;
}

/**
 * pending → paid after a Paystack-verified charge covers the quote.
 * Guarded on 'pending' so a webhook replay or a raced consume can never
 * regress a settled intent.
 */
export async function markAcademyFeeIntentPaid(
  reference: string,
  details: {
    providerReference?: string | null;
    paidAt?: string | null;
    verifiedAmountKobo?: number;
  } = {},
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('academy_application_fee_intents')
    .update({
      status: 'paid',
      provider_reference: details.providerReference ?? null,
      paid_at: details.paidAt ?? new Date().toISOString(),
      verified_amount_kobo: details.verifiedAmountKobo ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('reference', reference)
    .eq('status', 'pending');
  if (error) throw error;
}

/** Terminal marks for a charge that can never fund an application. */
export async function markAcademyFeeIntent(
  reference: string,
  status: 'amount_mismatch' | 'failed',
  failureReason?: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('academy_application_fee_intents')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(failureReason ? { failure_reason: failureReason } : {}),
    })
    .eq('reference', reference)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * paid → consumed, keyed to the application about to be inserted. Guarded on
 * 'paid' so only ONE submit can ever claim the charge — a raced or replayed
 * submit transitions nothing and returns false.
 */
export async function consumeAcademyFeeIntent(
  reference: string,
  applicationId: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('academy_application_fee_intents')
    .update({
      status: 'consumed',
      application_id: applicationId,
      consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('reference', reference)
    .eq('status', 'paid')
    .select('reference')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * consumed → paid, used ONLY to release a claim whose application insert
 * failed — the paid charge must stay usable or the applicant loses the fee.
 */
export async function releaseAcademyFeeIntent(reference: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('academy_application_fee_intents')
    .update({
      status: 'paid',
      application_id: null,
      consumed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('reference', reference)
    .eq('status', 'consumed');
  if (error) throw error;
}

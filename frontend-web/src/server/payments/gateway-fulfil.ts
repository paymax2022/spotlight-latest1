/**
 * Server-side fulfilment for Paystack gateway charges (AUD-FE-003 residual).
 *
 * The client's success callback is not guaranteed to fire — crash,
 * backgrounding, network drop — so anything the charge was buying must also be
 * settleable server-side. This module is the ONE place that maps a
 * Paystack-verified charge onto the pending records our own tables hold for
 * the reference, and it is shared by two callers:
 *
 *   - the Paystack webhook's gateway handler (primary path), and
 *   - POST /api/v1/payments/gateway/recover (verify-on-read self-heal for a
 *     charge whose webhook failed AND whose client never came back).
 *
 * Every domain here is idempotent: the vote bridge settles through the atomic
 * paid-vote RPC and a 'credited' row is skipped; a registration intent moves
 * initiated → completed once. A caller-side retry or a webhook replay is a
 * no-op, which is what makes webhook + recover safe to race.
 *
 * Academy tuition instalments ARE fulfilled here via the service-token-gated
 * internal confirm endpoint (POST /internal/finance/academy/tuition/confirm):
 * the pending instalment row is resolved from the verified charge's metadata
 * custom_fields (plan_id + installment_number) — it stores no reference until
 * paid — and Go re-runs the hardened confirm path end to end.
 *
 * Domains that CANNOT be fulfilled here (and why):
 *   - Reality-TV / contest-registration votes — the cast parameters (entry,
 *     quantity) live only in the client's verify request body, not in a
 *     server-side pending record keyed by reference. (Open Mic votes are
 *     covered via openmic_vote_paystack_intents.)
 *
 * The academy APPLICATION fee is covered differently: the academy_applications
 * row legitimately does not exist until the client submits it, so fulfilment
 * only marks the academy_application_fee_intents row paid — the intent is the
 * discoverable record, and POST /api/academy/apply consumes it when the form
 * finally arrives.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';
import {
  getRegistrationPaymentIntentByReference,
  applyRegistrationPaymentSuccess,
  markRegistrationPaymentIntentStatus,
  type RegistrationPaymentIntent,
} from '@/src/server/registration/supabase-store';
import {
  getOpenMicVoteIntentByReference,
  markOpenMicVoteIntent,
  type OpenMicVoteIntent,
} from '@/src/server/payments/openmic-vote-intents';
import {
  getAcademyFeeIntentByReference,
  markAcademyFeeIntent,
  markAcademyFeeIntentPaid,
  type AcademyFeeIntent,
} from '@/src/server/payments/academy-fee-intents';
import { castVote } from '@/src/server/openmic/persistence';
import { fulfilAcademyInstallment } from '@/src/server/payments/academy-tuition-fulfil';

export interface VoteTransactionTarget {
  id: string;
  vote_credit_status?: string | null;
}

export interface GatewayFulfilmentTargets {
  voteTransaction: VoteTransactionTarget | null;
  registrationIntent: RegistrationPaymentIntent | null;
  openmicIntent?: OpenMicVoteIntent | null;
  academyIntent?: AcademyFeeIntent | null;
}

export interface GatewayFulfilmentResult {
  /** Domain tags that settled on this call, e.g. 'vote', 'registration_fee'. */
  fulfilled: string[];
  /** Set when a domain's fulfilment failed — the caller should retry/500. */
  error?: string;
}

/** Vote transaction matching a Paystack reference, if any. */
export async function findVoteTransactionByReference(
  reference: string,
): Promise<VoteTransactionTarget | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('vote_transactions')
    .select('id, vote_credit_status')
    .eq('payment_reference', reference)
    .maybeSingle();
  return (data as VoteTransactionTarget | null) ?? null;
}

/** All reference-keyed pending records we can fulfil server-side. */
export async function findGatewayFulfilmentTargets(
  reference: string,
): Promise<GatewayFulfilmentTargets> {
  // A failed lookup is thrown, not swallowed — both callers treat it as
  // retryable (webhook: dispatcher 500 → Paystack redelivers; recover: 500 →
  // the caller retries) rather than silently reporting nothing to fulfil.
  const [voteTransaction, registrationIntent, openmicIntent, academyIntent] = await Promise.all([
    findVoteTransactionByReference(reference),
    getRegistrationPaymentIntentByReference(reference),
    getOpenMicVoteIntentByReference(reference),
    getAcademyFeeIntentByReference(reference),
  ]);
  return { voteTransaction, registrationIntent, openmicIntent, academyIntent };
}

/**
 * True while a registration fee intent can still be settled — 'initiated' and
 * 'verified' are the live states (the verify route treats both the same way);
 * 'completed' is a settled no-op and 'failed' is terminal for that intent.
 */
export function isActionableRegistrationIntent(
  intent: Pick<RegistrationPaymentIntent, 'status'> | null | undefined,
): boolean {
  return intent?.status === 'initiated' || intent?.status === 'verified';
}

/**
 * Apply a Paystack-confirmed charge to the given pending records.
 * `verifiedAmountKobo` is what Paystack ACTUALLY collected — never the
 * client's claim — so a short payment fails the intent instead of minting a
 * paid registration. `charge` carries the rest of the verified result for
 * domains that record it (provider reference, paid-at).
 */
export async function fulfilVerifiedGatewayCharge(
  reference: string,
  verifiedAmountKobo: number,
  targets: GatewayFulfilmentTargets,
  verifiedMetadata?: Record<string, unknown> | null,
  charge: { providerReference?: string | null; paidAt?: string | null } = {},
): Promise<GatewayFulfilmentResult> {
  const fulfilled: string[] = [];

  // ── Paid votes ────────────────────────────────────────────────────────────
  // The same atomic/idempotent bridge the v2 verify route uses — a client
  // callback or a second webhook delivery arriving later harmlessly no-ops on
  // 'credited'.
  const voteTx = targets.voteTransaction;
  if (voteTx?.id && voteTx.vote_credit_status !== 'credited') {
    const result = await bridgedVerifyPaidVote(
      { transactionId: voteTx.id, paymentReference: reference },
      'system:webhook',
      { ipAddress: '0.0.0.0', userAgent: 'paystack-webhook' },
    );
    if (!result.success) {
      return { fulfilled, error: result.error ?? 'vote fulfilment failed' };
    }
    fulfilled.push('vote');
  }

  // ── Registration fee ──────────────────────────────────────────────────────
  // Same rules as GET /api/registration/applications/[id]/payment/verify:
  // under-collection fails the intent, otherwise mark the draft paid and the
  // intent completed.
  const intent = targets.registrationIntent;
  if (isActionableRegistrationIntent(intent) && intent) {
    if (verifiedAmountKobo < intent.amountKobo) {
      await markRegistrationPaymentIntentStatus(
        intent.id,
        'failed',
        `Paystack collected ${verifiedAmountKobo} kobo, below the ${intent.amountKobo} kobo fee for intent ${intent.id}`,
      );
      // Terminal — nothing to retry, so this is not an error to the caller.
    } else {
      try {
        await applyRegistrationPaymentSuccess(intent.applicationId, {
          reference,
          method: 'PAYSTACK',
        });
        await markRegistrationPaymentIntentStatus(intent.id, 'completed');
        fulfilled.push('registration_fee');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { fulfilled, error: message };
      }
    }
  }

  // ── Open Mic paid vote ────────────────────────────────────────────────────
  // Frozen params + server-quoted amount from openmic_vote_paystack_intents;
  // the cast itself stays anchored on competition_entry_votes.payment_reference,
  // so a verify-route win or a webhook replay is a no-op.
  const omIntent = targets.openmicIntent;
  if (omIntent && omIntent.status === 'pending') {
    const supabase = createAdminClient();
    if (verifiedAmountKobo < omIntent.amount_kobo) {
      await markOpenMicVoteIntent(
        reference,
        'amount_mismatch',
        `Paystack collected ${verifiedAmountKobo} kobo, below the ${omIntent.amount_kobo} kobo quote`,
      );
    } else {
      const alreadyCast = await supabase
        .from('competition_entry_votes')
        .select('id')
        .eq('payment_reference', reference)
        .maybeSingle();
      if (!alreadyCast.data) {
        try {
          await castVote({
            contestId: omIntent.contest_id,
            submissionId: omIntent.submission_id,
            voterUserId: omIntent.voter_user_id,
            source: 'paid',
            votes: omIntent.votes,
            paymentReference: reference,
          });
        } catch (castErr) {
          // A concurrent verify may have won the insert — re-check before
          // treating the failure as retryable.
          const { data: raced } = await supabase
            .from('competition_entry_votes')
            .select('id')
            .eq('payment_reference', reference)
            .maybeSingle();
          if (!raced) {
            const message = castErr instanceof Error ? castErr.message : String(castErr);
            return { fulfilled, error: message };
          }
        }
      }
      await markOpenMicVoteIntent(reference, 'confirmed');
      fulfilled.push('open_mic_vote');
    }
  }

  // ── Academy application fee ───────────────────────────────────────────────
  // No academy_applications row exists yet — that's the point of the intent:
  // it is the durable record that the charge happened. Marking it paid lets
  // POST /api/academy/apply consume it whenever the form finally arrives, and
  // gives ops a row to reconcile if it never does (AUD-FE-003 residual).
  const academyIntent = targets.academyIntent;
  if (academyIntent && academyIntent.status === 'pending') {
    if (verifiedAmountKobo < academyIntent.amount_kobo) {
      await markAcademyFeeIntent(
        reference,
        'amount_mismatch',
        `Paystack collected ${verifiedAmountKobo} kobo, below the ${academyIntent.amount_kobo} kobo application-fee quote`,
      );
      // Terminal — nothing to retry, so this is not an error to the caller.
    } else {
      await markAcademyFeeIntentPaid(reference, {
        providerReference: charge.providerReference ?? null,
        paidAt: charge.paidAt ?? null,
        verifiedAmountKobo,
      });
      fulfilled.push('academy_application_fee');
    }
  }

  // ── Academy tuition instalment ────────────────────────────────────────────
  // The pending row carries no reference until paid, so resolution runs off the
  // VERIFIED charge's metadata (custom_fields plan_id + installment_number —
  // provider-authoritative, never the client's claim). Go re-verifies the
  // charge itself, so underpayment/currency mismatch still fails closed there.
  try {
    const outcome = await fulfilAcademyInstallment(reference, verifiedMetadata);
    if (outcome === 'fulfilled') fulfilled.push('academy_tuition');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { fulfilled, error: message };
  }

  return { fulfilled };
}

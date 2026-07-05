/**
 * Single Paystack verify wrapper for ALL three vote engines.
 *
 * There is exactly one server-side payment-verification implementation in the
 * web app: `src/server/voting/payment/paystack.ts`. Historically v1, v2 and
 * open-mic each imported it from slightly different call sites. This core
 * re-export makes `@/src/server/voting/core` the single import surface so the
 * verify behaviour (success flag, amount-in-kobo, provider reference) can never
 * diverge between engines.
 *
 * `verifyVotePayment` normalizes the result into the minimal shape the shared
 * idempotency/fraud/audit core needs, while still exposing the full
 * `PaystackVerificationResult` for engines that want it.
 */
import {
  verifyPaystackPayment,
  type PaystackVerificationResult,
} from '../payment/paystack';

export { verifyPaystackPayment };
export type { PaystackVerificationResult };

export interface VotePaymentVerification {
  success: boolean;
  /** Amount confirmed by the provider, in minor units (kobo). */
  amountKobo: number;
  currency: string;
  providerReference: string | null;
  paidAt: string | null;
  customerEmail: string | null;
  raw: PaystackVerificationResult;
}

/**
 * Canonical verify used by all three engines. One Paystack round-trip,
 * normalized to kobo so the amount-mismatch fraud signal is comparable
 * everywhere.
 */
export async function verifyVotePayment(reference: string): Promise<VotePaymentVerification> {
  const raw = await verifyPaystackPayment(reference);
  return {
    success: raw.success,
    amountKobo: raw.amountKobo,
    currency: raw.currency,
    providerReference: raw.providerReference,
    paidAt: raw.paidAt,
    customerEmail: raw.customerEmail,
    raw,
  };
}

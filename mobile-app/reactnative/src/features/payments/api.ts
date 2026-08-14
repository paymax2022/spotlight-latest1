// Shared checkout payment layer. Reuses the existing wallet top-up gateway
// (Paystack) so every module can offer the SAME two choices at checkout:
//   • Pay with wallet  → the module's existing wallet charge runs directly.
//   • Pay with card    → top up the exact amount via Paystack, wait for the
//                        webhook to credit the wallet, then run the module's
//                        existing wallet charge (net wallet change = 0).
//
// This keeps a single money rail (the wallet ledger) while exposing a real
// payment-gateway option at the point of sale in any module.

import { api } from '@/api/client';
import { initiateFunding } from '@/api/wallet.api';

import { pollUntilCredited, type TopupStatus } from './paymentFlow';

export type { TopupStatus };

/**
 * Start a Paystack top-up for an EXACT purchase amount, in kobo.
 *
 * The amount is passed through untouched. It previously converted kobo to naira
 * before calling initiateFunding — whose `amount` was already kobo — so it topped
 * up 1/100th of the purchase and every card checkout would have failed the
 * following wallet debit on insufficient funds. Rounding to whole naira was a
 * second defect: a ₦333.33 purchase could only ever top up ₦333.
 */
export async function startCardTopup(amountKobo: number): Promise<{ authorizationUrl: string; reference: string }> {
  return initiateFunding({ amountKobo });
}

/** Poll a top-up intent's status until the webhook credits the wallet. */
export async function getTopupStatus(reference: string): Promise<TopupStatus> {
  const res = await api.get(`/api/v1/wallet/topup/${encodeURIComponent(reference)}`);
  const d = res.data ?? {};
  return {
    reference: String(d.reference ?? reference),
    status: String(d.status ?? 'pending'),
    completed: Boolean(d.completed),
    amountKobo: Number(d.amount_kobo ?? 0),
  };
}

/**
 * Wait until a top-up is completed (webhook-credited) or time out.
 * Polls every `intervalMs` up to `timeoutMs`. Returns true if completed.
 */
export async function waitForTopup(
  reference: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: () => boolean } = {},
): Promise<boolean> {
  return pollUntilCredited(reference, getTopupStatus, opts);
}

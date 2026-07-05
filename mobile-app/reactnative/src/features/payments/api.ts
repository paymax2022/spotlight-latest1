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

export interface TopupStatus {
  reference: string;
  status: string;
  completed: boolean;
  amountKobo: number;
}

/** Start a Paystack top-up for an exact purchase amount (kobo). */
export async function startCardTopup(amountKobo: number): Promise<{ authorizationUrl: string; reference: string }> {
  // initiateFunding takes naira; convert from kobo and round to whole naira.
  const amountNaira = Math.max(1, Math.round(amountKobo / 100));
  return initiateFunding({ amount: amountNaira });
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
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 150000; // ~2.5 min
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.()) return false;
    try {
      const s = await getTopupStatus(reference);
      if (s.completed) return true;
      if (s.status === 'failed') return false;
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

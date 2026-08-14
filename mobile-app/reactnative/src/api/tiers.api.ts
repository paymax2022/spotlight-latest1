import { api } from '@/api/client';
import type { SpendLimit } from '@/features/payments/paymentFlow';

/**
 * GET /api/v1/me/tier — the caller's KYC tier plus TODAY'S remaining wallet-debit
 * allowance, proxied through to finance/tiers.GetUsage: the same source the
 * fail-closed server gate is derived from, so a client pre-check agrees with what
 * the server will actually do.
 *
 * Returns null when the allowance cannot be determined — either the request failed
 * or the server omitted the fields (it omits them rather than zeroing them when its
 * own usage lookup errors). Callers MUST treat null as "unknown", never as "no
 * allowance": the server-side gate is the authority, and blocking a checkout because
 * a read failed would be worse than letting the server refuse it.
 */
export async function getSpendLimit(): Promise<SpendLimit | null> {
  try {
    // skipAuthRedirect: this is an advisory read. A 401 here (expired session, or a
    // deployment without the route) must not sign the user out of their checkout —
    // their next real request will surface it.
    const res = await api.get('/api/v1/me/tier', { skipAuthRedirect: true });
    const data = (res.data?.data ?? res.data) as Record<string, unknown>;
    // The allowance fields travel together; if the server could not compute usage it
    // omits all of them, and a partial payload is not something to guess from.
    if (data?.remainingKobo == null || data?.dailyLimitKobo == null) return null;
    return {
      tier: Number(data.tier ?? 0),
      dailyLimitKobo: Number(data.dailyLimitKobo),
      dailyUsedKobo: Number(data.dailyUsedKobo ?? 0),
      remainingKobo: Number(data.remainingKobo),
      walletDisabled: Boolean(data.walletDisabled ?? Number(data.tier ?? 0) === 0),
      // Purchase allowance for an otherwise-disabled wallet (ADR-043). Absent on
      // an older server, which reads as "no allowance" — the strict refusal, i.e.
      // the behaviour before the allowance existed.
      checkoutEnabled: Boolean(data.checkoutEnabled ?? false),
      checkoutAllowanceKobo: Number(data.checkoutAllowanceKobo ?? 0),
      checkoutRemainingKobo: Number(data.checkoutRemainingKobo ?? 0),
    };
  } catch {
    return null;
  }
}

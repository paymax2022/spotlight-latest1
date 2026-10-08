/**
 * Shared helpers for the MONEY-LONG-TAIL E2E coverage specs (MTL).
 *
 * Lane: fx orchestration (/api/v1/fx/*), utilitybills member+admin,
 * transfers/resolve-account, restaurant bank-accounts — plus flag-gate
 * evidence probes for the modules whose routes are NOT mounted in the local
 * stack (crypto/invest/trading/fractionalre/spotlightwealth/arena/finance-fx/
 * maplerad/doctor).
 *
 * Everything auth/provisioning/ledger-fixture re-exports from the proven
 * finance/cross helper stacks. Fixture funding posts the SAME balanced journal
 * the top-up webhook posts (DR provider_clearing / CR user_wallet); kyc_tier is
 * seeded because the local stack has no KYC provider. Those are fixture setup
 * only; every product-state assertion goes through the real API surface or
 * read-only SQL.
 */

import type { APIRequestContext } from '@playwright/test';

import { GO_BACKEND_URL, psql } from '../auth/helpers';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  GO_BACKEND_URL,
  adminBearer,
  adminGo,
  adminGoAs,
  fundWallet,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  standingAccountBalance,
  uniqueEmail,
  walletBalance,
  type LedgerLeg,
  type ProvisionedUser,
} from '../cross/helpers';
export { assertKoboIntegers, bffFetch, idemKey, uniquePhone, walletBalanceSql } from '../finance/helpers';

/** Direct Go call with a bearer + arbitrary headers (incl. Idempotency-Key). */
export async function goFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** UNAUTHENTICATED call (provider webhook surface). */
export async function goFetchAnon(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/**
 * orch ledger legs (the FX orchestration module's own double-entry journal,
 * orch_ledger_entries — separate from the main ledger_entries it shares only
 * for the NGN pot). Sums by account/type for a reference or idempotency-key
 * pattern (SQL LIKE).
 */
export function orchLedgerSums(likePattern: string): { account: string; currency: string; side: string; total: number }[] {
  const out = psql(
    `select account || '|' || currency || '|' || type || '|' || sum(amount_minor) ` +
      `from orch_ledger_entries where reference like '${likePattern}' or idempotency_key like '${likePattern}' ` +
      `group by account, currency, type order by account, currency, type;`,
  );
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [account, currency, side, total] = line.split('|');
      return { account, currency, side, total: Number(total) };
    });
}

/** Per-currency balance check on orch_ledger_entries: DEBITs must equal CREDITs. */
export function orchLedgerBalanced(reference: string, currency: string): { debits: number; credits: number } {
  const out = psql(
    `select coalesce(sum(case when type='DEBIT' then amount_minor else 0 end),0) || '|' || ` +
      `coalesce(sum(case when type='CREDIT' then amount_minor else 0 end),0) ` +
      `from orch_ledger_entries where reference='${reference}' and currency='${currency}';`,
  );
  const [debits, credits] = (out || '0|0').split('|').map(Number);
  return { debits, credits };
}

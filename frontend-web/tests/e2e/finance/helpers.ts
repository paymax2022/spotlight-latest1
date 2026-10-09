/**
 * Shared helpers for the FINANCE-module E2E validation specs.
 *
 * Everything auth/provisioning/ledger-fixture is re-exported from the proven
 * auth/provider/cross helper stacks — fixture funding posts the SAME balanced
 * journal the top-up webhook posts (DR provider_clearing / CR user_wallet),
 * and kyc_tier is seeded because the local stack has no KYC provider. Those
 * are fixture setup only; every product-state assertion goes through the real
 * API surface or read-only SQL.
 *
 * Two call styles:
 *   goFetch — direct Go :8080 calls (RequireAuthContext accepts the GoTrue
 *             bearer; supports arbitrary headers incl. Idempotency-Key).
 *   bffFetch— same-origin :3000 calls through the real BFF proxies
 *             (/api/finance/[...path] catch-all → same Go path,
 *              /api/v1/savings/* → /api/finance/savings/*, etc.).
 */

import type { APIRequestContext } from '@playwright/test';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  ADMIN_WEB_URL,
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
  setProfilePhone,
  standingAccountBalance,
  uniqueEmail,
  walletBalance,
  type LedgerLeg,
  type ProvisionedUser,
} from '../cross/helpers';

import { GO_BACKEND_URL, psql } from '../auth/helpers';

/** Direct Go call with a bearer + arbitrary headers. */
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

/** Same-origin BFF call (relative path against the :3000 baseURL). */
export async function bffFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(path, {
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

let counter = 0;
/** Unique idempotency key per spec run — collisions would replay prior runs. */
export function idemKey(tag: string): string {
  counter += 1;
  return `e2e-fin-${tag}-${Date.now()}-${counter}`;
}

/**
 * A unique Nigerian mobile for this run. Recipient resolution matches the
 * 10-digit NSN, and two accounts sharing a number answer 409
 * ambiguous_recipient — a hardcoded phone reused across runs collides with
 * the user an earlier run already bound it to.
 */
export function uniquePhone(): string {
  counter += 1;
  const nsn = String(200_000_000 + ((Date.now() + counter) % 700_000_000)).slice(-9);
  return `08${nsn}`; // 11-digit local format → NSN = '8xxxxxxxxx'
}

/**
 * Sum a user's user_wallet pot straight from ledger_entries — the SQL-side
 * cross-check that the reported balance equals sum-of-entries (ledger is the
 * only source of truth; balances are projections).
 */
export function walletBalanceSql(userId: string): number {
  return Number(
    psql(
      `select coalesce(sum(case when le.type in ('CREDIT','REVERSAL_DEBIT') then le.amount_kobo ` +
        `when le.type in ('DEBIT','REVERSAL_CREDIT') then -le.amount_kobo else 0 end),0) ` +
        `from ledger_entries le join ledger_accounts la on la.id=le.account_id ` +
        `where la.user_id='${userId}' and la.type='user_wallet';`,
    ) || '0',
  );
}

/** Assert every *_kobo field in a payload is an integer number (no float math). */
export function assertKoboIntegers(payload: unknown, path = 'root'): string[] {
  const violations: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') {
      if (/_kobo$/i.test(p) && !Number.isInteger(v)) violations.push(`${p}=${v}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, `${p}.${k}`);
    }
  };
  walk(payload, path);
  return violations;
}

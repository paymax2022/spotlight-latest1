/**
 * Shared helpers for the COMMUNITY-FINANCE E2E validation specs
 * (crowdfunding, referral §7A + engine, association posture probe).
 *
 * Everything auth/provisioning/ledger-fixture is re-exported from the proven
 * finance/cross helper stacks. Fixture-only mutations (never product state via
 * SQL where a real API exists):
 *   - fundWallet posts the SAME balanced journal the top-up webhook posts;
 *   - setKycTier / setKycVerified promote accounts because the local stack has
 *     no KYC provider (the money-path tier gates read user_profiles directly);
 *   - seedCfBankAccount inserts a cf_bank_accounts row (there is no write API
 *     for it — the withdrawal path only READS saved accounts);
 *   - seedEligibleReferralReward inserts an eligible referral_reward_ledger
 *     row (real accruals arrive via purchase-settled hooks or mission claims —
 *     neither producible in this environment without an internal secret or a
 *     completed mission progress row).
 * Every product-state assertion goes through the real API surface or
 * read-only SQL (ledger legs, row counts).
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
  standingAccountBalance,
  uniqueEmail,
  walletBalance,
  goFetch,
  bffFetch,
  idemKey,
  assertKoboIntegers,
  walletBalanceSql,
  type LedgerLeg,
  type ProvisionedUser,
} from '../finance/helpers';

import { psql } from '../auth/helpers';
import { adminBearer, goFetch } from '../finance/helpers';

/**
 * Promote a fixture user to a wallet-enabled KYC tier AND mark them verified.
 * The referral withdraw gate (referral/ledger.verifiedKYCTier) requires
 * kyc_status='verified' AND kyc_tier >= 1; setKycTier alone leaves the status
 * column at its default and the withdraw path keeps refusing with 403.
 */
export function setKycVerified(userId: string, tier = 3): void {
  psql(
    `insert into public.user_profiles (id, email, kyc_tier, kyc_status) ` +
      `values ('${userId}','${userId}@seed.test',${tier},'verified') ` +
      `on conflict (id) do update set kyc_tier=${tier}, kyc_status='verified';`,
  );
}

/**
 * Insert a saved bank account for the crowdfunding creator-withdrawal flow.
 * cf_bank_accounts has only a READ endpoint (GET /bank-accounts) — there is no
 * API to create one, so this is fixture setup of an input row, identical in
 * spirit to how provisionVerifiedUser confirms emails in Postgres.
 */
export function seedCfBankAccount(userId: string, tag: string): string {
  return psql(
    `insert into public.cf_bank_accounts (user_id, bank_name, account_number_masked, account_name, is_default) ` +
      `values ('${userId}','E2E Bank','***${String(Date.now() % 10000).padStart(4, '0')}','E2E ${tag}',true) returning id;`,
  ).split('\n')[0];
}

/**
 * Insert an eligible (withdrawable) referral reward for a beneficiary.
 * Returns the reward-ledger row id. Real accrual paths (purchase-settled
 * internal hooks — REFERRAL_REWARDS_INTERNAL_SECRET unset locally; mission
 * claims — need a completed progress row no public API produces) cannot create
 * one in this environment, so this is the documented fixture precondition for
 * the withdraw money path.
 */
export function seedEligibleReferralReward(userId: string, amountKobo: number, tag: string): string {
  return psql(
    `insert into public.referral_reward_ledger ` +
      `(beneficiary_id, kind, state, amount_kobo, currency, is_house, idempotency_key) ` +
      `values ('${userId}','referrer','eligible',${amountKobo},'NGN',false,'e2e-seed-${tag}') returning id;`,
  ).split('\n')[0];
}

/** Count ledger_entries whose idempotency_key matches a LIKE pattern. */
export function countLegsByIdem(idemLike: string): number {
  return Number(
    psql(`select count(*) from ledger_entries where idempotency_key like '${idemLike}';`) || '0',
  );
}

/** Count ledger_entries whose reference matches a LIKE pattern. */
export function countLegsByRef(refLike: string): number {
  return Number(
    psql(`select count(*) from ledger_entries where reference like '${refLike}';`) || '0',
  );
}

/**
 * Balanced-legs check for a reference pattern: sums DEBIT-side and CREDIT-side
 * legs across all accounts and asserts they are equal and non-zero. Returns the
 * totals for annotation.
 */
export function ledgerTotalsByRef(refLike: string): { debits: number; credits: number } {
  const out = psql(
    `select ` +
      `coalesce(sum(case when le.type in ('DEBIT','REVERSAL_CREDIT') then le.amount_kobo else 0 end),0) || '|' || ` +
      `coalesce(sum(case when le.type in ('CREDIT','REVERSAL_DEBIT') then le.amount_kobo else 0 end),0) ` +
      `from ledger_entries le where le.reference like '${refLike}';`,
  );
  const [d, c] = (out || '0|0').split('|').map(Number);
  return { debits: d, credits: c };
}

/**
 * Direct call to a referral/crowdfunding admin route as the admin fixture.
 * These groups (:8080/api/{referral,crowdfunding}/admin/*) are gated by
 * RequireAuthContext + per-route RBAC — a GoTrue bearer for a super-admin is
 * sufficient; no x-admin-api-key layer exists here (unlike /api/v1/admin/*).
 */
export async function adminCommunityGo(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const token = await adminBearer(request);
  return goFetch(request, path, {
    method: opts.method,
    data: opts.data,
    token,
    headers: opts.headers,
  });
}

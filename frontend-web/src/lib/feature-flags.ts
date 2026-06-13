/**
 * Feature flags for the fintech transformation.
 *
 * All flags default to DISABLED (false) when the env var is absent or not
 * exactly 'true'. This is the safe default: unknown state = feature off.
 *
 * Each flag is a function so it re-reads process.env on every call, making
 * flags configurable in tests without module reimport.
 *
 * Usage:
 *   import { featureFlags, requireFeature } from '@/src/lib/feature-flags';
 *   if (!featureFlags.wallet()) return errorResponse('Wallet not available', 503);
 *   // or: requireFeature('wallet'); // throws ApiError(503) if disabled
 *
 * To enable in local dev add to frontend-web/.env.local:
 *   FEATURE_WALLET_ENABLED=true
 */

import { ApiError } from '@/src/lib/api/responses';

function envFlag(varName: string): boolean {
  return process.env[varName] === 'true';
}

export const featureFlags = {
  /** EPIC 1 & 3 — Wallet, ledger, topup, virtual accounts */
  wallet: () => envFlag('FEATURE_WALLET_ENABLED'),

  /** EPIC 2 — KYC tiers and document verification */
  kyc: () => envFlag('FEATURE_KYC_ENABLED'),

  /** EPIC 3 — Paystack Dedicated Virtual Account auto-provisioning */
  virtualAccounts: () => envFlag('FEATURE_VIRTUAL_ACCOUNTS_ENABLED'),

  /** EPIC 4 — Vote bridge: idempotency fix + KYC gate on vote paths */
  votesBridge: () => envFlag('VOTES_BRIDGE_ENABLED'),

  /** EPIC 5 — Referral codes and ledger rewards */
  referrals: () => envFlag('FEATURE_REFERRALS_ENABLED'),

  /** EPIC 6 — Fintech admin RBAC (maker-checker) */
  fintechAdmin: () => envFlag('FEATURE_FINTECH_ADMIN_ENABLED'),

  /** Block 7 — Per-tier daily wallet and vote limits (fail-closed enforcement) */
  tierLimits: () => envFlag('FEATURE_TIER_LIMITS_ENABLED'),
} as const;

export type FeatureName = keyof typeof featureFlags;

/**
 * Throws ApiError(503) when the requested feature flag is disabled.
 * Use at the top of route handlers to gate entire endpoints.
 *
 * Example:
 *   requireFeature('wallet');
 */
export function requireFeature(name: FeatureName): void {
  if (!featureFlags[name]()) {
    throw new ApiError(
      `Feature '${name}' is not available in this environment.`,
      503,
    );
  }
}

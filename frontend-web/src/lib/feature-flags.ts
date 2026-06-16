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

  /** Utility bills engine — provider routing, wallet debit, receipts */
  utilityPayments: () => envFlag('FEATURE_UTILITY_PAYMENTS_ENABLED'),

  /** Block 10 — Paymax-to-Paymax instant wallet transfer */
  walletTransfers: () => envFlag('FEATURE_WALLET_TRANSFERS_ENABLED'),

  /** Block 11 — Wallet-to-bank account transfer via Paystack Transfers */
  walletBankTransfers: () => envFlag('FEATURE_BANK_TRANSFERS_ENABLED'),

  /** Block 12 — Saved beneficiaries for repeat bank transfers */
  beneficiaries: () => envFlag('FEATURE_BENEFICIARIES_ENABLED'),

  /** P3 Lane B — Community groups with wallet-backed dues payments */
  groups: () => envFlag('FEATURE_GROUPS_ENABLED'),

  /** P3 Lane C — Ticketed events with QR codes and escrow settlement */
  events: () => envFlag('FEATURE_EVENTS_ENABLED'),

  /** P3 Lane D — Estate access control and private elections */
  estate: () => envFlag('FEATURE_ESTATE_ENABLED'),

  /** P3 Lane E — Crowdfunding campaigns with escrow and goal tracking */
  crowdfunding: () => envFlag('FEATURE_CROWDFUNDING_ENABLED'),

  /** P3 Lane F — Restaurant and food delivery with rider dispatch */
  restaurant: () => envFlag('FEATURE_RESTAURANT_ENABLED'),

  /** P3 Lane G — Telemedicine: doctors, appointments, prescriptions */
  telemedicine: () => envFlag('FEATURE_TELEMEDICINE_ENABLED'),

  /** Transport — ride-hailing: drivers, trips, fare settlement */
  transport: () => envFlag('FEATURE_TRANSPORT_ENABLED'),

  /** AI Customer Care — chat sessions, AI reply, escalation to agent */
  aiCare: () => envFlag('FEATURE_AICARE_ENABLED'),

  /** P3 Lane H — Wallet-paid votes via Go vote-bridge debit endpoint */
  voteBridge: () => envFlag('FEATURE_VOTE_BRIDGE_ENABLED'),

  /** FX currency exchange via Maplerad */
  fx: () => envFlag('FEATURE_FX_ENABLED'),
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

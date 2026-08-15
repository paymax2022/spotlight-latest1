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

  /** Micro-insurance / Protection module (MyCover + Octamile via gateway) */
  insurance: () => envFlag('FEATURE_INSURANCE_ENABLED'),

  /** Hotel Booking / Stays module (Property Suite, dual-rail supply gateway) */
  stays: () => envFlag('FEATURE_STAYS_ENABLED'),

  /** Top-5 expansion modules (no-new-licence; existing wallet/ledger rails) */
  events: () => envFlag('FEATURE_EVENTS_ENABLED'),
  socialPay: () => envFlag('FEATURE_SOCIAL_PAY_ENABLED'),
  savings: () => envFlag('FEATURE_SAVINGS_ENABLED'),
  creators: () => envFlag('FEATURE_CREATORS_ENABLED'),
  loyalty: () => envFlag('FEATURE_LOYALTY_ENABLED'),

  /** Health verticals (marketplace; licensed partners deliver care) */
  health: () => envFlag('FEATURE_HEALTH_ENABLED'),
  healthPharmacy: () => envFlag('FEATURE_HEALTH_PHARMACY_ENABLED'),
  healthLab: () => envFlag('FEATURE_HEALTH_LAB_ENABLED'),
  healthVet: () => envFlag('FEATURE_HEALTH_VET_ENABLED'),

  /** EPIC 6 — Fintech admin RBAC (maker-checker) */
  fintechAdmin: () => envFlag('FEATURE_FINTECH_ADMIN_ENABLED'),

  /** Block 7 — Per-tier daily wallet and vote limits (fail-closed enforcement) */
  tierLimits: () => envFlag('FEATURE_TIER_LIMITS_ENABLED'),

  /**
   * ADR-042 — let an UNVERIFIED (Tier 0) account pay by card at checkout, under a
   * capped rolling allowance, instead of being refused outright.
   *
   * This relaxes a KYC gate, so it defaults off like every other flag and should
   * only be turned on deliberately.
   *
   * ⚠️ DO NOT ENABLE YET. A ledger-auditor review found blockers that make the
   * relaxation unsafe and non-functional as it stands:
   *   - [FIXED, ADR-045] the card rail credited ledger type 'wallet' while the Go
   *     modules debit 'user_wallet'. One plane now: both mutate 'user_wallet';
   *   - [PARTLY ADDRESSED] the Tier-0 cash-out ban this relaxation depends on
   *     lives behind FEATURE_TIER_LIMITS_ENABLED. Both .env examples now ship it
   *     true, but examples are templates — CONFIRM the real value in the deploy
   *     environment before relying on the ban;
   *   - the funding cap is a read-then-insert with no lock, so concurrent
   *     requests exceed it.
   * See ADR-042 / ADR-043 and the review notes before flipping this.
   */
  checkoutTopupTier0: () => envFlag('FEATURE_CHECKOUT_TOPUP_TIER0'),

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

  /** Realtor — property graph, listings, inspections, leases, shortlet, AI assist */
  realtor: () => envFlag('FEATURE_REALTOR_ENABLED'),

  /** Dispute management — users raise tickets; admin resolves */
  disputes: () => envFlag('FEATURE_DISPUTES_ENABLED'),

  /** Post-transaction ratings for doctors, riders, restaurants, etc. */
  ratings: () => envFlag('FEATURE_RATINGS_ENABLED'),

  /** Group / Association membership — dues, directory, meetings, chat, AI notes */
  association: () => envFlag('FEATURE_ASSOCIATION_ENABLED'),
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

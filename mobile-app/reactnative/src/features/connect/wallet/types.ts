// Paymax Connect — Wallet / Gifting / Tier-KYC / Payout types (PRD §6.4, §7, §10.9 WL-*).
//
// SAFETY INVARIANTS (docs/prd/dating/CLAUDE.md):
//  • Payments ONLY via the Paymax wallet. Gifting is wallet-to-wallet REAL Naira.
//  • Entitlements & tier checks are server-side; the client renders read-only
//    projections of backend-owned config + verification state.
//  • Every money-moving surface shows tier + daily limit + remaining allowance.
//  • Every mutation carries an Idempotency-Key.
//  • ALL monetary amounts are integers in minor units (kobo) — never float.

import type { ConnectTier, TierStatus, WalletSummary } from '../types/connect.types';

// Re-export the foundation types so wallet screens can import from one place
// without redefining them. TierStatus / WalletSummary remain owned by
// connect.types.ts — these are pass-through aliases only.
export type { ConnectTier, TierStatus, WalletSummary };

// ─────────────────────────────────────────────────────────────────────────────
// Wallet ledger / history (WL-01..WL-04)
// ─────────────────────────────────────────────────────────────────────────────

export type WalletEntryDirection = 'credit' | 'debit';

export type WalletEntryKind =
  | 'fund'          // top-up from Paymax wallet
  | 'gift_sent'     // wallet-to-wallet gift out
  | 'gift_received' // wallet-to-wallet gift in
  | 'payout'        // creator gift-revenue withdrawal
  | 'boost'         // discovery boost / spotlight spend
  | 'refund'
  | 'reversal';

export type WalletEntryStatus = 'completed' | 'pending' | 'failed' | 'reversed';

// A ledger-style line item. `amountKobo` is always positive; `direction` carries
// the sign. `balanceAfterKobo` is the running wallet projection after this entry.
export interface WalletEntry {
  id: string;
  ref: string;                  // human-facing reference / receipt id
  kind: WalletEntryKind;
  direction: WalletEntryDirection;
  amountKobo: number;
  balanceAfterKobo: number;
  status: WalletEntryStatus;
  title: string;                // e.g. "Gift to Zainab", "Wallet top-up"
  counterpartyName?: string;
  note?: string;
  createdAt: string;            // ISO
}

export interface WalletHistoryPage {
  entries: WalletEntry[];
  nextCursor?: string;
}

// Result of a fund (top-up) mutation. The wallet balance is a projection of the
// ledger — the server returns the new projected balance + the created entry.
export interface FundResult {
  ok: boolean;
  entry: WalletEntry;
  balanceKobo: number;
  tier: TierStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gifting (PRD §6.4) — wallet-to-wallet real Naira
// ─────────────────────────────────────────────────────────────────────────────

export interface GiftProduct {
  id: string;
  name: string;
  emoji: string;
  priceKobo: number;
  description: string;
  tierMin: ConnectTier;         // minimum tier required to send this gift
}

export interface GiftRecipient {
  id: string;
  displayName: string;
  avatarUrl?: string;
  handle?: string;
}

// Quote returned before confirming a send — server computes tier remaining so
// the confirm screen can show "remaining after this gift" without local math.
export interface GiftQuote {
  product: GiftProduct;
  recipient: GiftRecipient;
  amountKobo: number;           // == product.priceKobo (gift is fixed-price)
  feeKobo: number;
  totalKobo: number;
  tier: TierStatus;
  remainingAfterKobo: number | null; // null => unlimited (Tier 3)
  withinLimit: boolean;
}

export interface SendGiftInput {
  productId: string;
  recipientId: string;
  message?: string;
}

export interface GiftTransaction {
  id: string;
  ref: string;
  product: GiftProduct;
  recipient: GiftRecipient;
  sender?: GiftRecipient;
  amountKobo: number;
  status: WalletEntryStatus;
  message?: string;
  createdAt: string;
}

export interface SendGiftResult {
  ok: boolean;
  transaction: GiftTransaction;
  balanceKobo: number;
  tier: TierStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier / KYC upgrade flows (PRD §7) — CBN three-tier model
// ─────────────────────────────────────────────────────────────────────────────

export type KycStepState = 'not_started' | 'pending' | 'passed' | 'rejected';

export interface TierLimitsRow {
  tier: ConnectTier;
  label: string;
  requirement: string;
  dailyLimitKobo: number | null;    // null => no fixed ceiling (Tier 3)
  singleGiftMaxKobo: number | null;
  withdrawDailyKobo: number | null; // null/0 => withdraw disabled
  privileges: string[];
}

// Detailed verification state for the upgrade journey. Mirrors TierStatus but
// carries the per-document KYC progress the upgrade screens render.
export interface KycStatus {
  tier: ConnectTier;
  label: string;
  bvn: KycStepState;
  nin: KycStepState;
  photoId: KycStepState;
  address: KycStepState;
  liveness: KycStepState;
  edd: KycStepState;            // enhanced due diligence (Tier 3)
  // Overall review state for an in-flight upgrade application.
  reviewState: 'none' | 'pending' | 'rejected';
  rejectionReason?: string;
  pendingTarget?: ConnectTier;  // tier being applied for, when reviewState=pending
}

// Inputs for each upgrade step. The server verifies against the official
// registries — the client never stores or validates the raw identifiers beyond
// basic shape checks.
export interface Tier1Input {
  identifier: string;           // BVN (11 digits) or NIN (11 digits)
  identifierType: 'bvn' | 'nin';
}

export interface Tier2Input {
  idType: 'passport' | 'drivers_license' | 'voters_card' | 'national_id';
  idDocumentUri: string;        // local/remote URI of captured ID
  addressLine: string;
  city: string;
  state: string;
  proofOfAddressUri: string;    // utility bill / bank statement URI
}

export interface Tier3Input {
  livenessUri: string;          // captured liveness selfie/video URI
  sourceOfFunds: string;        // EDD: declared source of funds
  occupation: string;
  expectedMonthlyVolumeKobo: number;
}

export interface UpgradeResult {
  ok: boolean;
  reviewState: 'pending' | 'passed';
  // Projected tier the application targets (server confirms on approval).
  targetTier: ConnectTier;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Creator payouts (PRD §10.9) — gift-revenue withdrawal, Tier2+ & KYC gated
// ─────────────────────────────────────────────────────────────────────────────

export interface PayoutEligibility {
  eligible: boolean;
  tier: TierStatus;
  // Earnings available to withdraw (projection of the creator earnings ledger).
  availableKobo: number;
  pendingKobo: number;
  minPayoutKobo: number;
  // Withdraw is enabled only at Tier 2+ with completed KYC.
  reason?: string;              // why ineligible (e.g. "Reach Tier 2 to withdraw")
  payoutMethodMasked?: string;  // e.g. "GTBank ••• 4421"
}

export interface PayoutRequestInput {
  amountKobo: number;
}

export interface PayoutRequest {
  id: string;
  ref: string;
  amountKobo: number;
  feeKobo: number;
  netKobo: number;
  status: 'requested' | 'processing' | 'paid' | 'failed';
  payoutMethodMasked: string;
  createdAt: string;
}

export interface PayoutRequestResult {
  ok: boolean;
  request: PayoutRequest;
  availableKobo: number;
}

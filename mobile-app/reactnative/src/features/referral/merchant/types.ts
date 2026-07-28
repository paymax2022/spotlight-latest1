// ── Referral Merchant Zone (lite) types (M-MER-01..03) ───────────────────────
// Merchant dashboard, create/fund campaign (wallet), performance. Money is
// ALWAYS integer kobo. Campaigns are funded from the merchant's wallet; the
// funding mutation is a money-path call (idempotency key on the live path).

// ── Dashboard (M-MER-01) ─────────────────────────────────────────────────────
export type MerchantCampaignStatus = 'active' | 'paused' | 'draft' | 'ended' | 'out_of_budget';

export interface MerchantCampaignSummary {
  id: string;
  name: string;
  status: MerchantCampaignStatus;
  /** Total funded budget, integer kobo. */
  budgetKobo: number;
  /** Spent so far, integer kobo. */
  spentKobo: number;
  conversions: number;
  startedAt: string | null;
}

export interface MerchantDashboard {
  /** Wallet balance available to fund campaigns, integer kobo. */
  walletBalanceKobo: number;
  /** Across all campaigns. */
  totalSpentKobo: number;
  totalConversions: number;
  activeCampaigns: number;
  campaigns: MerchantCampaignSummary[];
}

// ── Create / fund campaign (M-MER-02) ────────────────────────────────────────
export interface CreateCampaignInput {
  name: string;
  /** Reward per verified conversion, integer kobo. */
  rewardPerConversionKobo: number;
  /** Total budget to fund from wallet, integer kobo. */
  budgetKobo: number;
  /** Qualifying action that counts as a conversion. */
  qualifyingAction: 'first_transaction' | 'kyc_completed' | 'purchase';
}

export interface FundCampaignResult {
  ok: boolean;
  campaignId: string;
  fundedKobo: number;
  newWalletBalanceKobo: number;
  reference: string;
  error?: 'insufficient_funds' | 'invalid_amount' | 'failed';
}

// ── Performance (M-MER-03) ───────────────────────────────────────────────────
export interface PerformancePoint {
  label: string;
  conversions: number;
  spendKobo: number;
}

export interface MerchantPerformance {
  campaignId: string;
  campaignName: string;
  budgetKobo: number;
  spentKobo: number;
  conversions: number;
  /** Cost per verified conversion, integer kobo. */
  costPerConversionKobo: number;
  /** Return on spend as a multiple (e.g. 3.2 = 3.2x). */
  roas: number;
  series: PerformancePoint[];
}

// ── Fractional Real Estate / Land Crowd-Investing — Types ────────────────────
// Investor module (PRD §8). All monetary values are integer kobo (minor units).
// Mirrors the canonical backend at /api/finance/fractionalre.

export type OfferingKind = 'income_property' | 'development_debt' | 'land';

export type RiskBand = 'conservative' | 'balanced' | 'growth' | 'speculative';

export type OfferingStatus =
  | 'open'        // accepting subscriptions
  | 'funding'     // open + has a funding window/countdown
  | 'funded'      // fully subscribed
  | 'closing'     // window ending soon
  | 'closed'      // no longer open
  | 'settled';    // settled / operational

export type LimitStatus = 'pass' | 'warn' | 'block';

export type InvestorClassification = 'retail' | 'qualified' | 'hni';

export type PayoutFrequency = 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'on_exit';

export type HoldingStatus = 'active' | 'maturing' | 'exited' | 'defaulted';

export type MarketOrderStatus = 'open' | 'matched' | 'filled' | 'cancelled' | 'expired';

// ── Investor profile / account ───────────────────────────────────────────────

export interface InvestorProfile {
  id:                  string;
  status:              'inactive' | 'pending_suitability' | 'active' | 'restricted';
  classification:      InvestorClassification;
  riskProfile:         RiskBand | null;
  /** Remaining yearly subscription allowance for retail investors (kobo). */
  remainingAllowanceKobo: number;
  annualLimitKobo:     number;
  kycVerified:         boolean;
  suitabilityComplete: boolean;
  masterRiskAckId:     string | null;
  createdAt:           string;
}

export interface SuitabilityInput {
  annualIncomeKobo:   number;
  netWorthKobo:       number;
  investmentHorizon:  'short' | 'medium' | 'long';
  riskTolerance:      'low' | 'medium' | 'high';
  experience:         'none' | 'some' | 'experienced';
  acceptedDeclaration: boolean;
}

export interface SuitabilityResult {
  riskProfile:        RiskBand;
  classification:     InvestorClassification;
  annualLimitKobo:    number;
  eligibleKinds:      OfferingKind[];
}

// ── Offerings (marketplace) ──────────────────────────────────────────────────

export interface OfferingSummary {
  id:               string;
  kind:             OfferingKind;
  title:            string;
  location:         string;
  coverImageUrl:    string;
  riskBand:         RiskBand;
  /** Projected net annual yield in basis points (e.g. 1450 = 14.5%). */
  projectedYieldBps: number;
  /** Target tenor in months. */
  tenorMonths:      number;
  unitPriceKobo:    number;
  minUnits:         number;
  raisedKobo:       number;
  targetKobo:       number;
  status:           OfferingStatus;
  titleVerified:    boolean;
  /** ISO timestamp when the funding window closes; null = no countdown. */
  closesAt:         string | null;
  payoutFrequency:  PayoutFrequency;
  watched:          boolean;
}

export interface CapTableSlice {
  label:   string;
  pct:     number;   // 0..100
}

export interface OfferingDocument {
  id:      string;
  label:   string;
  kind:    'title_deed' | 'survey' | 'valuation' | 'offer_memo' | 'spv' | 'statement' | 'certificate' | 'other';
  url:     string;
  sizeKb:  number;
}

export interface OfferingFaq {
  q: string;
  a: string;
}

export interface OfferingDetail extends OfferingSummary {
  summary:         string;
  sponsor:         string;
  spvName:         string;
  assetDescription: string;
  /** Lat/lng for the marketplace map. */
  lat:             number;
  lng:             number;
  /** Risk factors (SEC-style disclosures). */
  riskFactors:     string[];
  capTable:        CapTableSlice[];
  documents:       OfferingDocument[];
  faq:             OfferingFaq[];
  /** Grossed-out fee schedule basis points for the order summary. */
  platformFeeBps:  number;
  /** Risk-ack id required for subscription (per-offer). */
  offerRiskAckId:  string | null;
}

// ── Limit check (server-authoritative) ───────────────────────────────────────

export interface LimitCheckResult {
  status:         LimitStatus;
  remainingKobo:  number;
  message?:       string;
}

// ── Subscription ─────────────────────────────────────────────────────────────

export interface SubscribeRequest {
  /** Exactly one of units / amountKobo is sent. */
  units?:          number;
  amountKobo?:     number;
  pin:             string;
  idempotencyKey:  string;
  offerRiskAckId:  string;
}

export interface FeeBreakdown {
  grossKobo:     number;
  platformFeeKobo: number;
  totalKobo:     number;
  units:         number;
}

export interface Certificate {
  investmentId:   string;
  certificateNo:  string;
  offeringTitle:  string;
  units:          number;
  amountKobo:     number;
  issuedAt:       string;
  spvName:        string;
  documentUrl:    string;
}

export interface SubscribeResult {
  investmentId:   string;
  status:         'confirmed' | 'pending';
  certificate:    Certificate;
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export interface PortfolioOverview {
  totalValueKobo:     number;
  investedKobo:       number;
  totalReturnsKobo:   number;     // realised + projected lifetime
  unrealisedGainKobo: number;
  walletBalanceKobo:  number;
  nextPayout:         { dueAt: string; amountKobo: number } | null;
  allocation:         AllocationSlice[];
  holdingsCount:      number;
}

export interface AllocationSlice {
  kind:    OfferingKind;
  label:   string;
  valueKobo: number;
  pct:     number;     // 0..100
}

export interface Holding {
  id:               string;
  offeringId:       string;
  title:            string;
  kind:             OfferingKind;
  coverImageUrl:    string;
  units:            number;
  investedKobo:     number;
  currentValueKobo: number;
  /** Realised payouts to date (kobo). */
  payoutsToDateKobo: number;
  projectedYieldBps: number;
  status:           HoldingStatus;
  maturesAt:        string | null;
  acquiredAt:       string;
}

export interface PerformancePoint { t: string; valueKobo: number; }

export interface HoldingDetail extends Holding {
  performance:    PerformancePoint[];
  payouts:        Payout[];
  updates:        { id: string; date: string; title: string; body: string }[];
  documents:      OfferingDocument[];
  /** Current NAV per unit for exit/sell anchoring (kobo). */
  navPerUnitKobo: number;
}

export interface Payout {
  id:            string;
  holdingId:     string;
  offeringTitle: string;
  amountKobo:    number;
  status:        'paid' | 'scheduled' | 'processing';
  paidAt:        string | null;
  dueAt:         string;
  kind:          'rent' | 'interest' | 'capital' | 'dividend';
}

export interface Statement {
  id:       string;
  period:   string;   // e.g. "2026-Q1"
  label:    string;
  url:      string;
  issuedAt: string;
}

// ── Auto-invest ──────────────────────────────────────────────────────────────

export interface AutoInvestPlan {
  id:               string;
  amountKobo:       number;
  frequency:        'weekly' | 'monthly';
  riskBand:         RiskBand;
  kinds:            OfferingKind[];
  status:           'active' | 'paused';
  nextRunAt:        string;
  totalInvestedKobo: number;
}

export interface AutoInvestInput {
  amountKobo: number;
  frequency:  'weekly' | 'monthly';
  riskBand:   RiskBand;
  kinds:      OfferingKind[];
}

// ── Secondary market ─────────────────────────────────────────────────────────

export interface MarketListing {
  id:              string;
  holdingId:       string;
  offeringId:      string;
  offeringTitle:   string;
  kind:            OfferingKind;
  units:           number;
  /** Seller asking price per unit (kobo). */
  pricePerUnitKobo: number;
  /** Reference NAV per unit at listing time (kobo). */
  navPerUnitKobo:  number;
  totalKobo:       number;
  status:          MarketOrderStatus;
  listedAt:        string;
  sellerMasked:    string;     // e.g. "Investor ***42"
}

export interface ListFractionInput {
  holdingId:        string;
  units:            number;
  pricePerUnitKobo: number;
}

export interface MarketOrder {
  id:            string;
  listingId:     string;
  offeringTitle: string;
  side:          'buy' | 'sell';
  units:         number;
  amountKobo:    number;
  status:        MarketOrderStatus;
  createdAt:     string;
}

export interface BuyListingRequest {
  units:          number;
  pin:            string;
  idempotencyKey: string;
}

// ── Documents vault / certificates ───────────────────────────────────────────

export interface VaultDocument {
  id:        string;
  label:     string;
  kind:      OfferingDocument['kind'];
  offeringTitle: string;
  url:       string;
  sizeKb:    number;
  issuedAt:  string;
}

// ── Beneficiaries ────────────────────────────────────────────────────────────
// Wire format is snake_case per the backend contract. share_pct is an INTEGER
// percentage (0..100) — never a float. The server enforces Σ share_pct ≤ 100
// across a user's rows, max 10 rows, name 2–80 chars, relationship 2–40 chars.

export interface Beneficiary {
  id:           string;
  name:         string;
  relationship: string;
  /** Integer percentage share, 1..100. */
  share_pct:    number;
}

export interface BeneficiaryInput {
  name:         string;
  relationship: string;
  /** Integer percentage share, 1..100. */
  share_pct:    number;
}

// ── Referrals ────────────────────────────────────────────────────────────────
// GET /referrals returns either the summary or { enabled: false } when the
// referral programme is not yet live for this user.

export interface ReferralSummary {
  enabled?:    true;
  code:        string;
  invited:     number;
  joined:      number;
  earned_kobo: number;
}

export type Referrals = ReferralSummary | { enabled: false };

// ── Goals ────────────────────────────────────────────────────────────────────

export interface InvestGoal {
  id:           string;
  name:         string;
  targetKobo:   number;
  savedKobo:    number;
  targetDate:   string;
  kind:         OfferingKind | 'mixed';
}

export interface CreateGoalInput {
  name:       string;
  targetKobo: number;
  targetDate: string;
  kind:       OfferingKind | 'mixed';
}

// ── Returns calculator (client preview only — server is authoritative) ───────

export interface ReturnsCalcInput {
  amountKobo:        number;
  projectedYieldBps: number;
  tenorMonths:       number;
  payoutFrequency:   PayoutFrequency;
}

export interface ReturnsCalcResult {
  periodicPayoutKobo: number;
  totalIncomeKobo:    number;
  projectedExitKobo:  number;
  payoutsCount:       number;
}

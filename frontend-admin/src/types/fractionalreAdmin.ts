// ── Admin — Fractional Real Estate / Land Crowd-Investing control-plane types ──
// All money is integer minor units (kobo). Mirrors estateAdmin.ts / investAdmin.ts.
// Status unions track the asset lifecycle Draft → … → Closed.

// ─── Dashboard (9.A.2) ──────────────────────────────────────────────────────
export interface FractionalReKpis {
  aumKobo: number;              // assets under management
  totalRaisedKobo: number;      // cumulative across all rounds
  activeInvestors: number;
  liveRounds: number;
  payoutsDueKobo: number;       // distributions scheduled/awaiting release
  pipelineValueKobo: number;    // draft/under-review asset value
}

export type AlertKind = 'limit_breach' | 'failing_round' | 'kyc_backlog' | 'expiring_doc' | 'price_anomaly';

export interface FractionalReAlert {
  id: string;
  kind: AlertKind;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  ref?: string;        // entity reference (asset/round/investor id)
  at: string;          // ISO
}

export interface FractionalReDashboard {
  kpis: FractionalReKpis;
  alerts: FractionalReAlert[];
}

// ─── Assets (9.B) ───────────────────────────────────────────────────────────
// Lifecycle states for an asset / opportunity.
export type AssetStatus =
  | 'Draft'
  | 'UnderReview'
  | 'TitleVerification'
  | 'Approved'
  | 'FundingOpen'
  | 'Funded'
  | 'Operational'
  | 'Distributing'
  | 'Exited'
  | 'Closed'
  | 'Rejected';

export type AssetType = 'residential' | 'commercial' | 'land' | 'mixed_use' | 'industrial' | 'agricultural';

export interface AssetReturnsModel {
  targetYieldBps: number;       // target annual yield in basis points
  tenorMonths: number;
  distributionFrequency: 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'on_exit';
  capitalAppreciationBps?: number;
}

export interface AssetDocument {
  id: string;
  kind: 'title' | 'valuation' | 'insurance' | 'deed' | 'consent' | 'survey' | 'agreement' | 'other';
  name: string;
  url?: string;
  version: number;
  uploadedAt: string;
}

export interface AdminAsset {
  id: string;
  name: string;
  type: AssetType;
  location: string;
  geoPin?: { lat: number; lng: number };
  status: AssetStatus;
  totalValueKobo: number;
  unitPriceKobo: number;
  totalUnits: number;
  unitsSold: number;
  sponsorId?: string;
  sponsorName?: string;
  titleVerified: boolean;
  returnsModel: AssetReturnsModel;
  mediaUrls: string[];
  documents: AssetDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetInput {
  name: string;
  type: AssetType;
  location: string;
  totalValueKobo: number;
  unitPriceKobo: number;
  targetYieldBps: number;
  tenorMonths: number;
  sponsorId?: string;
  mediaUrls?: string[];
}

export interface AssetPatch {
  name?: string;
  location?: string;
  totalValueKobo?: number;
  unitPriceKobo?: number;
  sponsorId?: string;
  returnsModel?: Partial<AssetReturnsModel>;
}

// 9.B.3 — Title verification checklist
export type TitleCheckDecision = 'clear' | 'query' | 'reject';
export interface TitleCheckItem {
  key: string;
  label: string;      // e.g. "C of O / Deed", "Governor's consent"
  passed: boolean;
  note?: string;
}
export interface TitleVerification {
  assetId: string;
  checklist: TitleCheckItem[];
  registryCheckRef?: string;
  decision?: TitleCheckDecision;
  verifierId?: string;
  decidedAt?: string;
}
export interface TitleVerifyInput {
  checklist: TitleCheckItem[];
  registryCheckRef?: string;
  decision: TitleCheckDecision;
  note?: string;
}

export interface AssetTransitionInput {
  toStatus: AssetStatus;
  reason: string;
}

// ─── Funding rounds (9.C) ────────────────────────────────────────────────────
export type RoundStatus =
  | 'Draft'
  | 'Open'
  | 'MinMet'
  | 'Closing'
  | 'Closed'
  | 'Refunding'
  | 'Refunded'
  | 'Allocated'
  | 'Cancelled';

export interface AdminRound {
  id: string;
  assetId: string;
  assetName: string;
  status: RoundStatus;
  targetKobo: number;
  minThresholdKobo: number;
  unitPriceKobo: number;
  ticketMinKobo: number;
  ticketMaxKobo: number;
  raisedKobo: number;
  investorCount: number;
  watchers: number;
  escrowAccountRef: string;
  opensAt: string;
  closesAt: string;
  extensionsUsed: number;
  createdAt: string;
}

export interface CreateRoundInput {
  assetId: string;
  targetKobo: number;
  minThresholdKobo: number;
  unitPriceKobo: number;
  ticketMinKobo: number;
  ticketMaxKobo: number;
  opensAt: string;
  closesAt: string;
  escrowAccountRef?: string;
}

export interface ExtendRoundInput {
  newClosesAt: string;
  reason: string;
}

// maker-checker actions carry an optional approval reference
export interface MakerCheckerResult {
  id: string;
  status: string;
  pendingApproval: boolean;
  maker?: string;
  checker?: string;
}

// ─── Cap table (9.D) ──────────────────────────────────────────────────────────
export interface CapTableEntry {
  id: string;
  investorId: string;
  investorName: string;
  units: number;
  ownershipPct: number;       // 0-100
  acquisitionDate: string;
  source: 'primary' | 'secondary' | 'correction';
  certificateRef?: string;
}

export interface CapTable {
  assetId: string;
  assetName: string;
  totalUnits: number;
  unitsAllocated: number;
  entries: CapTableEntry[];
}

export interface TransferUnitsInput {
  assetId: string;
  fromInvestorId: string;
  toInvestorId: string;
  units: number;
  reason: string;
  source: 'secondary' | 'correction';
}

// ─── Investors (9.E) ──────────────────────────────────────────────────────────
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'expired';
export type InvestorClassification = 'retail' | 'qualified' | 'hni' | 'institutional';

export interface AdminInvestorSummary {
  id: string;
  name: string;
  email: string;
  kycStatus: KycStatus;
  classification: InvestorClassification;
  aumKobo: number;
  holdingsCount: number;
  joinedAt: string;
}

export interface InvestorLimit {
  investorId: string;
  classification: InvestorClassification;
  annualCapKobo: number;        // e.g. 10% rule limit
  investedThisYearKobo: number;
  remainingAllowanceKobo: number;
  capPct: number;               // platform-wide cap (e.g. 10)
  breached: boolean;
  overrideActive: boolean;
}

export interface AdminInvestorDetail extends AdminInvestorSummary {
  phone: string;
  incomeOnFileKobo: number;
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  limit: InvestorLimit;
  holdings: CapTableEntry[];
}

export interface LimitOverrideInput {
  newAnnualCapKobo: number;
  reason: string;
  expiresAt?: string;
}

export interface ClassifyInvestorInput {
  classification: InvestorClassification;
  evidenceRef?: string;
  reason: string;
}

// ─── KYC & Compliance (9.F) ───────────────────────────────────────────────────
export interface KycQueueItem {
  userId: string;
  name: string;
  submittedAt: string;
  classification: InvestorClassification;
  slaHoursRemaining: number;
  amlFlags: string[];          // watchlist / sanctions hits
  documents: { kind: string; name: string; url?: string }[];
}

export type KycDecisionType = 'approve' | 'reject' | 'request_more';
export interface KycDecisionInput {
  decision: KycDecisionType;
  reason: string;
  requestedDocs?: string[];
}

export interface ComplianceDashboard {
  openKycCount: number;
  amlOpenCases: number;
  activeBreaches: number;
  activeOverrides: number;
  expiringDocsCount: number;
  breaches: { investorId: string; investorName: string; detail: string; at: string }[];
  overrides: { investorId: string; investorName: string; reason: string; by: string; at: string }[];
}

// ─── Distributions (9.G) ──────────────────────────────────────────────────────
export type DistributionStatus =
  | 'Draft'
  | 'Calculated'
  | 'PendingApproval'
  | 'Approved'
  | 'Executing'
  | 'Completed'
  | 'PartiallyFailed'
  | 'Cancelled';

export interface AdminDistribution {
  id: string;
  assetId: string;
  assetName: string;
  period: string;             // e.g. "2026-Q2"
  grossAmountKobo: number;
  source: 'rental_income' | 'sale_proceeds' | 'interest' | 'other';
  status: DistributionStatus;
  maker?: string;
  checker?: string;
  createdAt: string;
  approvedAt?: string;
}

export interface ScheduleDistributionInput {
  assetId: string;
  period: string;
  grossAmountKobo: number;
  source: AdminDistribution['source'];
}

export interface DistributionLineItem {
  investorId: string;
  investorName: string;
  units: number;
  ownershipPct: number;
  grossKobo: number;
  feeKobo: number;
  withholdingTaxKobo: number;
  netKobo: number;
  exception?: string;          // e.g. "wallet frozen", "KYC expired"
}

export interface DistributionPreview {
  distributionId: string;
  grossAmountKobo: number;
  totalFeesKobo: number;
  totalWithholdingKobo: number;
  totalNetKobo: number;
  lineItems: DistributionLineItem[];
  exceptions: DistributionLineItem[];
}

export interface DistributionDecisionInput {
  reason: string;
}

// ─── Secondary market (9.H) ───────────────────────────────────────────────────
export type ListingStatus = 'active' | 'halted' | 'matched' | 'cancelled';
export interface SecondaryListing {
  id: string;
  assetId: string;
  assetName: string;
  sellerId: string;
  sellerName: string;
  units: number;
  askPriceKobo: number;        // per unit
  navPriceKobo: number;        // current NAV per unit
  pricePremiumPct: number;     // ask vs NAV
  status: ListingStatus;
  listedAt: string;
}

export interface MarketControls {
  secondaryFeeBps: number;
  priceBandPct: number;        // allowed deviation from NAV
  tradingPaused: boolean;
  pausedAssetIds: string[];
}

// ─── Sponsors (9.I) ───────────────────────────────────────────────────────────
export type SponsorKybStatus = 'pending' | 'verified' | 'rejected' | 'suspended';
export interface AdminSponsor {
  id: string;
  entityName: string;
  rcNumber: string;
  contactName: string;
  contactEmail: string;
  kybStatus: SponsorKybStatus;
  trackRecord: string;
  assetsSubmitted: number;
  totalRaisedKobo: number;
  submittedAt: string;
}

export interface CreateSponsorInput {
  entityName: string;
  rcNumber: string;
  contactName: string;
  contactEmail: string;
  trackRecord?: string;
}

// ─── Finance / Treasury (9.J) ─────────────────────────────────────────────────
export interface EscrowAccount {
  roundId: string;
  assetName: string;
  escrowAccountRef: string;
  inflowsKobo: number;
  outflowsKobo: number;
  balanceKobo: number;
  reconciled: boolean;
  asOf: string;
}

export interface FeeRevenue {
  totalFeesKobo: number;
  managementFeesKobo: number;
  listingFeesKobo: number;
  secondaryFeesKobo: number;
  performanceFeesKobo: number;
  fxFeesKobo: number;
  period: string;
}

export interface RefundResult {
  roundId: string;
  refundedKobo: number;
  investorCount: number;
  status: string;
  pendingApproval: boolean;
}

// ─── Documents (9.K) ──────────────────────────────────────────────────────────
export interface DocumentRecord {
  id: string;
  kind: AssetDocument['kind'] | 'template';
  name: string;
  assetId?: string;
  version: number;
  url?: string;
  signed: boolean;
  uploadedAt: string;
}

export interface PresignResult {
  uploadUrl: string;
  fileUrl: string;
  expiresAt: string;
}

// ─── Audit (9.O.1) ────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;            // e.g. "asset.transition", "distribution.approve"
  entityType: string;
  entityId: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: string;
}

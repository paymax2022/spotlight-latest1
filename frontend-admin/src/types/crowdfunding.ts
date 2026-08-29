// ── Admin — Crowdfunding types ───────────────────────────────────────────────
// All monetary amounts are integers in minor units (kobo).

export type CfCampaignStatus =
  | 'PENDING_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FROZEN'
  | 'REJECTED';

export type CfCampaignType = 'DONATION' | 'REWARD' | 'COMMUNITY' | 'SME';

export type CfRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type CfVerification = 'UNVERIFIED' | 'EMAIL' | 'KYC' | 'KYB' | 'FULL';

export interface CfBudgetItem {
  id: string;
  label: string;
  amountKobo: number;
}

export interface CfDocument {
  id: string;
  label: string;
  type: 'pdf' | 'image';
  verified: boolean;
}

export interface CfRiskSignal {
  id: string;
  label: string;
  severity: CfRiskLevel;
}

export interface CfReviewCampaign {
  id: string;
  title: string;
  summary: string;
  story: string;
  type: CfCampaignType;
  status: CfCampaignStatus;
  category: string;
  coverImage: string | null;
  goalKobo: number;
  raisedKobo: number;
  contributorCount: number;
  createdAt: string;
  submittedAt: string;
  // Creator
  creatorName: string;
  creatorType: string;
  creatorVerification: CfVerification;
  creatorEmail: string;
  beneficiaryName: string;
  beneficiaryRelationship: string;
  bankLabel: string;
  location: string;
  disbursementModel: string;
  refundPolicy: string;
  budget: CfBudgetItem[];
  documents: CfDocument[];
  riskLevel: CfRiskLevel;
  riskScore: number;        // 0-100
  riskSignals: CfRiskSignal[];
  adminNote: string | null;
}

export type CfReviewDecision = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'FREEZE' | 'UNFREEZE';

export interface CfPlatformStats {
  totalCampaigns: number;
  activeCampaigns: number;
  pendingReview: number;
  rejectedCampaigns: number;
  totalRaisedKobo: number;
  platformRevenueKobo: number;
  escrowKobo: number;
  withdrawalsPending: number;
  withdrawalsPendingKobo: number;
  refundRequests: number;
  fraudAlerts: number;
  openTickets: number;
  paymentSuccessRate: number;   // 0-100
  categoryBreakdown: { category: string; count: number; raisedKobo: number }[];
}

export type CfWithdrawalStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';

export interface CfWithdrawal {
  id: string;
  reference: string;
  campaignTitle: string;
  creatorName: string;
  creatorVerification: CfVerification;
  amountKobo: number;
  availableKobo: number;
  bankLabel: string;
  status: CfWithdrawalStatus;
  requestedAt: string;
  riskLevel: CfRiskLevel;
  note: string | null;
}

export type CfFraudStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FROZEN';

export interface CfFraudAlert {
  id: string;
  campaignTitle: string;
  campaignId: string;
  creatorName: string;
  riskLevel: CfRiskLevel;
  status: CfFraudStatus;
  signals: string[];
  raisedKobo: number;
  createdAt: string;
}

// ─── Finance (refunds, chargebacks, settlement) ───────────────────────────────

export type CfRefundStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSED';

export interface CfRefundRequest {
  id: string;
  reference: string;
  campaignTitle: string;
  contributorName: string;
  amountKobo: number;
  reason: string;
  status: CfRefundStatus;
  requestedAt: string;
  refundEligible: boolean;
}

export type CfSettlementStatus = 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED';

export interface CfSettlementBatch {
  id: string;
  reference: string;
  payoutCount: number;
  grossKobo: number;
  feeKobo: number;
  netKobo: number;
  status: CfSettlementStatus;
  createdAt: string;
}

export interface CfFinanceSummary {
  gmvKobo: number;
  platformRevenueKobo: number;
  refundsPendingKobo: number;
  refundsPendingCount: number;
  chargebacksKobo: number;
  chargebacksCount: number;
  escrowKobo: number;
  settledThisMonthKobo: number;
  reconciliationMismatches: number;
}

// ─── Support & disputes ───────────────────────────────────────────────────────

export type CfDisputeType = 'FAKE_CAMPAIGN' | 'REFUND' | 'REWARD' | 'PAYMENT' | 'WITHDRAWAL' | 'OTHER';
export type CfDisputeStatus = 'OPEN' | 'INVESTIGATING' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type CfDisputeResolution = 'NO_ACTION' | 'REFUND' | 'PARTIAL_REFUND' | 'FREEZE' | 'WARN_CREATOR';

export interface CfDispute {
  id: string;
  reference: string;
  type: CfDisputeType;
  status: CfDisputeStatus;
  campaignTitle: string;
  campaignId: string;
  raisedBy: string;
  description: string;
  createdAt: string;
  slaHoursLeft: number;
  resolution: CfDisputeResolution | null;
  adminNote: string | null;
}

// ─── Platform configuration ───────────────────────────────────────────────────

export interface CfCategoryConfig {
  id: string;
  label: string;
  slug: string;
  enabled: boolean;
  requiresEnhancedReview: boolean;
  campaignCount: number;
}

export interface CfFeeConfig {
  platformFeeBps: number;      // basis points
  paymentFeeBps: number;
  paymentFeeFlatKobo: number;
  minContributionKobo: number;
  maxContributionKobo: number;
}

export interface CfFeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;             // e.g. investment flag stays off until licensed
}

// ─── KYC / KYB verification ───────────────────────────────────────────────────

export type CfKycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// Sourced from the platform's shared KYC (finance/kyc), not a crowdfunding-
// specific dataset — there's no business-entity (KYB) tier, so every case is
// an individual identity verification distinguished only by requested tier.
export interface CfKycCase {
  id: string; // the user's id
  status: CfKycStatus;
  applicantName: string;
  applicantType: string; // always 'Individual'
  email: string;
  tier: number; // requested tier (1-3)
  documentType: string | null;
  submittedAt: string;
  verifiedAt: string | null;
}

// ─── Compliance ───────────────────────────────────────────────────────────────

export interface CfAuditLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  ip: string;
}

export type CfDataRequestType = 'EXPORT' | 'DELETION';
export type CfDataRequestStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface CfDataRequest {
  id: string;
  type: CfDataRequestType;
  userName: string;
  email: string;
  status: CfDataRequestStatus;
  requestedAt: string;
  dueBy: string;
}

export interface CfComplianceSummary {
  pendingKyc: number;
  pendingKyb: number;
  openDataRequests: number;
  investmentEnabled: boolean;
  retentionPolicyDays: number;
  lastRegulatoryExport: string;
  auditEventsToday: number;
}

// ─── User & Creator management ────────────────────────────────────────────────

export type CfUserStatus = 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED';
export type CfUserRole = 'CONTRIBUTOR' | 'CREATOR' | 'ORGANISATION';

export interface CfUserActivity {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface CfUser {
  id: string;
  name: string;
  email: string;
  role: CfUserRole;
  type: string;                  // 'Individual' | 'NGO' | 'SME'
  verification: CfVerification;
  status: CfUserStatus;
  riskLevel: CfRiskLevel;
  campaignsCreated: number;
  totalRaisedKobo: number;
  totalContributedKobo: number;
  joinedAt: string;
  lastActiveAt: string;
  activity: CfUserActivity[];
}

// ─── Featured / promotion management ─────────────────────────────────────────
// Promotion flags are editorial placement, not money — but they are only valid on
// a LIVE campaign, so the backend refuses (4xx) setting any of them true on a
// campaign whose status is not ACTIVE. See CfCampaignStatus above.

export interface CfFeaturedCampaign {
  id: string;
  title: string;
  status: CfCampaignStatus;
  category: string;
  featured: boolean;
  trending: boolean;
  urgent: boolean;
  verified: boolean;
  raisedKobo: number;
  goalKobo: number;
  contributorCount: number;
  createdAt: string;
}

/** The three operator-editable promotion flags (`verified` is set by KYC review, not here). */
export type CfCampaignFlag = 'featured' | 'trending' | 'urgent';

/** PATCH body: only the supplied keys change. */
export type CfCampaignFlags = Partial<Record<CfCampaignFlag, boolean>>;

export interface CfFeaturedReportEntry {
  id: string;
  title: string;
  raisedKobo: number;
  contributorCount: number;
}

export interface CfFeaturedReport {
  featuredCount: number;
  trendingCount: number;
  urgentCount: number;
  activeCount: number;
  featured: CfFeaturedReportEntry[];
  /**
   * Outstanding owner feature requests. OPTIONAL — the report endpoint predates
   * the request queue and may not carry it. When absent the console derives the
   * number from the queue itself, so the stat card is correct either way.
   */
  pendingRequestCount?: number;
}

// ─── Feature requests (owner-initiated) ──────────────────────────────────────
// Featuring is deliberately NOT self-serve: `featured` is an editorial placement
// on the public discovery rail, so a campaign owner can only REQUEST it and an
// admin approves. (Owners can always UNfeature themselves without approval, which
// is why there is no "un-feature request" in this model.)
//
// Approving sets the campaign's `featured` flag, so it inherits the same rule the
// PATCH .../flags endpoint enforces: only an ACTIVE campaign can be promoted, and
// anything else is refused with 409. `campaignStatus` is carried on the request so
// the console can gate the action instead of offering a guaranteed failure.

export type CfFeatureRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * The campaign's status as reported on the request row.
 *
 * 'UNKNOWN' is not a backend value — it is what the mapper produces when the wire
 * payload carries no recognisable campaign status. It exists so a field-name drift
 * degrades to a visible "cannot confirm this is ACTIVE" (approval gated, reason
 * shown) rather than silently mis-gating rows.
 */
export type CfFeatureRequestCampaignStatus = CfCampaignStatus | 'UNKNOWN';

export interface CfFeatureRequest {
  id: string;
  campaignId: string;
  campaignTitle: string;
  status: CfFeatureRequestStatus;
  campaignStatus: CfFeatureRequestCampaignStatus;
  raisedKobo: number;
  goalKobo: number;
  contributorCount: number;
  requestedBy: string;
  requestedAt: string;
  /** Admin note captured on reject. Null while PENDING and on approve. */
  note: string | null;
  /** When the request was actioned. Null while PENDING. */
  decidedAt: string | null;
}

// Crowdfunding domain types for the CUSTOMER-facing module (discovery, campaign
// detail, donate, create-campaign wizard, my donations).
// These mirror the Go backend's wire shapes verbatim, verified directly against
// backend/internal/crowdfunding/{dto.go,model.go,service_discovery.go,
// engage/comments.go,creator/model.go} — not inferred from the mobile client.
// Unlike the admin-console types in src/types/crowdfunding.ts (a different
// bounded context — the review-queue DTOs, `Cf`-prefixed), this module's wire
// format is camelCase (the discovery/detail/creator-package endpoints), EXCEPT
// the root `/contribute` endpoint and its bare `Contribution` response, which
// is genuinely snake_case — a different Go type than the creator package's
// (also called `Contribution`) camelCase one used by GET /contributions. Both
// are kept below with distinct names to avoid collapsing two different shapes
// into one.

export type Kobo = number;

export type CampaignType = 'DONATION' | 'REWARD' | 'COMMUNITY' | 'SME';

// Collapsed customer-facing status — the backend's own `CHANGES_REQUESTED`
// review state is always presented as PENDING_REVIEW to non-admin readers.
export type CampaignStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FROZEN';

export interface CampaignCategory {
  id: string;
  slug: string;
  label: string;
  icon: string;
  tint: string;
  campaignCount: number;
}

export interface CampaignSummary {
  id: string;
  title: string;
  summary: string;
  type: CampaignType;
  status: CampaignStatus;
  category: string;
  categoryLabel: string;
  coverImage: string | null;
  goalKobo: Kobo;
  raisedKobo: Kobo;
  currency: string;
  contributorCount: number;
  deadline: string | null;
  verified: boolean;
  featured: boolean;
  trending: boolean;
  urgent: boolean;
  saved: boolean;
  location: string | null;
  creatorName: string;
  creatorType: string;
  creatorVerification: string;
}

export interface CampaignCreator {
  id: string;
  name: string;
  type: string;
  avatarUrl: string | null;
  verification: string;
  location: string | null;
  campaignsCreated: number;
  totalRaisedKobo: Kobo;
  bio: string | null;
  joinedAt: string;
  followed: boolean;
}

export interface CampaignBeneficiary {
  id: string;
  name: string;
  relationship: string;
  description: string | null;
  verified: boolean;
}

export interface BudgetItem {
  id: string;
  label: string;
  amountKobo: Kobo;
  note: string | null;
}

export type MilestoneStatus = 'LOCKED' | 'ACTIVE' | 'RELEASED' | 'PENDING_REVIEW';

export interface CampaignMilestone {
  id: string;
  title: string;
  targetKobo: Kobo;
  status: MilestoneStatus;
  dueAt: string | null;
  evidenceCount: number;
}

export interface CampaignUpdate {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  createdAt: string;
  likeCount: number;
}

export interface RewardTier {
  id: string;
  title: string;
  amountKobo: Kobo;
  description: string;
  estimatedDelivery: string | null;
  claimed: number;
  limit: number | null;
  requiresShipping: boolean;
}

export interface CampaignDocument {
  id: string;
  label: string;
  type: 'pdf' | 'image';
  sizeLabel: string;
  verified: boolean;
  url: string;
}

export interface CampaignDetail extends Omit<CampaignSummary, never> {
  story: string;
  media: string[];
  createdAt: string;
  creator: CampaignCreator;
  beneficiary: CampaignBeneficiary | null;
  disbursementModel: string;
  refundPolicy: string;
  riskDisclosure: string | null;
  budget: BudgetItem[];
  milestones: CampaignMilestone[];
  updates: CampaignUpdate[];
  rewardTiers: RewardTier[];
  documents: CampaignDocument[];
  commentCount: number;
  faqs: never[];
  tags: never[];
}

export interface Contributor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  amountKobo: Kobo;
  message: string | null;
  anonymous: boolean;
  createdAt: string;
}

export interface CommentReply {
  authorName: string;
  body: string;
  createdAt: string;
  isCreator: boolean;
}

export interface CampaignComment {
  id: string;
  campaignId: string;
  authorName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  isQuestion: boolean;
  isCreator: boolean;
  reported: boolean;
  replies: CommentReply[];
}

// This is the ONLY payload the live endpoint accepts. anonymous/message/
// rewardTierId exist in other contexts (the creator-package Contribution read
// model) but are NOT persisted by this endpoint today — don't build a donate
// form that collects them and silently drops them.

export interface ContributeRequest {
  amount_kobo: Kobo;
  idempotency_key: string;
}

export type RawContributionStatus = 'escrowed' | 'released' | 'refunded';

export interface RawContribution {
  id: string;
  campaign_id: string;
  contributor_id: string;
  amount_kobo: Kobo;
  status: RawContributionStatus;
  idempotency_key: string;
  settlement_id: string;
  created_at: string;
}

export type ContributionStatus =
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'PENDING'
  | 'REFUND_REQUESTED'
  | 'REFUNDED';

export interface Contribution {
  id: string;
  reference: string;
  campaignId: string;
  campaignTitle: string;
  campaignCover: string | null;
  amountKobo: Kobo;
  feeKobo: Kobo;
  netToCampaignKobo: Kobo;
  totalKobo: Kobo;
  currency: string;
  status: ContributionStatus;
  paymentMethod: string;
  anonymous: boolean;
  message: string | null;
  rewardTierTitle: string | null;
  createdAt: string;
  refundEligible: boolean;
}

// Maps the donate endpoint's own status vocabulary onto the richer
// ContributionStatus union used everywhere else in the UI (mobile does the
// same mapping — see api.ts). Never guess FAILED for an unrecognized 2xx.
export function mapRawStatus(status: RawContributionStatus): ContributionStatus {
  if (status === 'escrowed' || status === 'released') return 'SUCCESSFUL';
  if (status === 'refunded') return 'REFUNDED';
  return 'PROCESSING';
}

export interface SubmitBudgetItem {
  label: string;
  amountKobo: Kobo;
  note?: string;
}

export interface SubmitRewardTier {
  title: string;
  amountKobo: Kobo;
  description?: string;
  estimatedDelivery?: string;
  limit?: number;
  requiresShipping?: boolean;
}

export interface SubmitMilestone {
  title: string;
  targetKobo: Kobo;
  status?: 'LOCKED' | 'ACTIVE' | '';
  dueAt?: string;
}

export interface SubmitBeneficiary {
  name: string;
  relationship: string;
  description?: string;
}

export interface SubmitCampaignRequest {
  type: CampaignType;
  category: string;
  title: string;
  summary?: string;
  story?: string;
  goalKobo: Kobo;
  deadline?: string;
  location?: string;
  refundPolicy?: string;
  disbursementModel?: string;
  coverImageUrl?: string | null;
  submitForReview: boolean;
  milestones?: SubmitMilestone[];
  budget?: SubmitBudgetItem[];
  rewardTiers?: SubmitRewardTier[];
  beneficiary?: SubmitBeneficiary | null;
}

export interface SubmitCampaignResult {
  campaignId: string;
  status: 'DRAFT' | 'PENDING_REVIEW';
  reference: string;
}

export interface UploadResult {
  url: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
}

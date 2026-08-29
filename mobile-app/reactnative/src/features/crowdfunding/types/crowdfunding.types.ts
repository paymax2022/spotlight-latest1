// ── Crowdfunding — Type Contract ─────────────────────────────────────────────
// Source of truth the screens code against (Backend role owns this file).
// IRON RULE: all monetary amounts are integers in minor units (kobo). Never floats.

export type CampaignStatus =
  | 'ACTIVE'
  | 'PAUSED'          // owner-paused: hidden from public discovery, funds untouched
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FROZEN'          // paused by Trust & Safety — the owner cannot resume it
  | 'REJECTED';

export type CampaignType =
  | 'DONATION'
  | 'REWARD'
  | 'COMMUNITY'
  | 'SME'
  | 'INVESTMENT';

export type DisbursementModel =
  | 'IMMEDIATE'        // direct-to-wallet, admin-approved withdrawal
  | 'ALL_OR_NOTHING'  // refunded if target not met
  | 'FLEXIBLE'        // keep whatever is raised
  | 'MILESTONE'       // released per milestone
  | 'ESCROW';         // held until target

export type CreatorType =
  | 'INDIVIDUAL'
  | 'ORGANISATION'
  | 'NGO'
  | 'SME'
  | 'COMMUNITY';

export type VerificationLevel = 'UNVERIFIED' | 'EMAIL' | 'KYC' | 'KYB' | 'FULL';

export interface CampaignCategory {
  id: string;
  slug: string;          // 'medical' | 'education' | ...
  label: string;
  icon: string;          // lucide icon name
  tint: 'purple' | 'blue' | 'teal' | 'orange' | 'green' | 'red';
  campaignCount: number;
}

export interface CampaignCreator {
  id: string;
  name: string;
  type: CreatorType;
  avatarUrl: string | null;
  verification: VerificationLevel;
  location: string | null;
  campaignsCreated: number;
  totalRaisedKobo: number;
  bio: string | null;
  joinedAt: string;
  followed?: boolean;
}

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string;          // 'Self' | 'Mother' | 'Community' ...
  description: string | null;
  verified: boolean;
}

export interface BudgetItem {
  id: string;
  label: string;
  amountKobo: number;
  note: string | null;
}

export interface CampaignMilestone {
  id: string;
  title: string;
  targetKobo: number;
  status: 'LOCKED' | 'ACTIVE' | 'RELEASED' | 'PENDING_REVIEW';
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

export interface Contributor {
  id: string;
  displayName: string;       // 'Anonymous' when private
  avatarUrl: string | null;
  amountKobo: number;
  message: string | null;
  anonymous: boolean;
  createdAt: string;
}

export interface RewardTier {
  id: string;
  title: string;
  amountKobo: number;        // minimum pledge
  description: string;
  estimatedDelivery: string | null;
  claimed: number;
  limit: number | null;      // null = unlimited
  requiresShipping: boolean;
}

export interface CampaignMedia {
  id: string;
  type: 'image' | 'video';
  url: string;
  thumbnailUrl: string | null;
}

export interface CampaignDocument {
  id: string;
  label: string;
  type: 'pdf' | 'image';
  sizeLabel: string;
  verified: boolean;
}

export interface CampaignFaq {
  id: string;
  question: string;
  answer: string;
}

export interface Campaign {
  id: string;
  title: string;
  summary: string;
  story: string;             // long-form (markdown-ish plain text)
  type: CampaignType;
  status: CampaignStatus;
  category: CampaignCategory['slug'];
  categoryLabel: string;
  coverImage: string | null;
  media: CampaignMedia[];

  goalKobo: number;
  raisedKobo: number;
  currency: 'NGN';
  contributorCount: number;
  deadline: string | null;   // ISO; null = no deadline (flexible)
  createdAt: string;

  creator: CampaignCreator;
  beneficiary: Beneficiary | null;
  disbursementModel: DisbursementModel;
  refundPolicy: string;
  riskDisclosure: string | null;

  verified: boolean;
  featured: boolean;
  trending: boolean;
  urgent: boolean;
  saved?: boolean;

  /**
   * State of the owner's request to be featured on the discovery rail.
   * OPTIONAL because it is owner-scoped: the public campaign payload does not
   * carry it. When the server omits it we fall back to `featured` alone (see
   * `featureRequestState` in crowdfundingFormatters) rather than guessing that
   * no request is outstanding — an owner must never be shown "Request feature"
   * for a request that is already sitting in an admin queue.
   */
  featureRequestStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

  budget: BudgetItem[];
  milestones: CampaignMilestone[];
  updates: CampaignUpdate[];
  rewardTiers: RewardTier[];
  documents: CampaignDocument[];
  faqs: CampaignFaq[];
  tags: string[];
  location: string | null;
}

/** Lightweight shape used in feed/list cards (subset of Campaign). */
export type CampaignSummary = Pick<
  Campaign,
  | 'id' | 'title' | 'summary' | 'type' | 'status' | 'category' | 'categoryLabel'
  | 'coverImage' | 'goalKobo' | 'raisedKobo' | 'currency' | 'contributorCount'
  | 'deadline' | 'verified' | 'featured' | 'trending' | 'urgent' | 'saved' | 'location'
> & { creatorName: string; creatorType: CreatorType; creatorVerification: VerificationLevel };

// ─── Discovery query params ───────────────────────────────────────────────────

export type CampaignSort =
  | 'recommended'
  | 'trending'
  | 'newest'
  | 'ending_soon'
  | 'most_funded'
  | 'least_funded';

export interface CampaignFilter {
  category?: string;
  type?: CampaignType;
  verifiedOnly?: boolean;
  urgentOnly?: boolean;
  location?: string;
  minProgress?: number;   // 0-100
  status?: CampaignStatus;
}

export interface CampaignQuery extends CampaignFilter {
  search?: string;
  sort?: CampaignSort;
  collection?: 'featured' | 'trending' | 'urgent' | 'verified' | 'recommended' | 'recent';
  page?: number;
  limit?: number;
}

// ─── Contribution flow ────────────────────────────────────────────────────────

export type PaymentMethod = 'WALLET' | 'CARD' | 'BANK_TRANSFER' | 'USSD';

export interface FeeBreakdown {
  contributionKobo: number;   // amount that reaches the campaign
  platformFeeKobo: number;
  paymentFeeKobo: number;
  tipKobo: number;            // optional creator/platform tip
  totalKobo: number;          // total debited from contributor
}

export interface ShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
}

export interface ContributionDraft {
  campaignId: string;
  amountKobo: number;
  anonymous: boolean;
  message: string | null;
  rewardTierId: string | null;
  shipping: ShippingAddress | null;
  paymentMethod: PaymentMethod;
  acceptedRefundPolicy: boolean;
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
  amountKobo: number;
  feeKobo: number;
  totalKobo: number;
  currency: 'NGN';
  status: ContributionStatus;
  paymentMethod: PaymentMethod;
  anonymous: boolean;
  message: string | null;
  rewardTierTitle: string | null;
  createdAt: string;
  refundEligible: boolean;
}

export interface InitiateContributionResult {
  reference: string;
  status: ContributionStatus;
  authorizationUrl?: string;   // for card/bank redirect
}

// ─── Creator dashboard (Section F) ────────────────────────────────────────────

export interface CreatorStats {
  totalRaisedKobo: number;
  contributorCount: number;
  activeCampaigns: number;
  totalCampaigns: number;
  availableBalanceKobo: number;   // withdrawable now
  pendingBalanceKobo: number;     // settling
  escrowBalanceKobo: number;      // held until milestone/target
  viewsThisWeek: number;
  conversionRate: number;         // 0-100
}

export interface CreatorContribution {
  id: string;
  contributorName: string;        // 'Anonymous' when private
  campaignTitle: string;
  amountKobo: number;
  createdAt: string;
  anonymous: boolean;
}

export type WithdrawalStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'COMPLETED'
  | 'REJECTED';

export interface CreatorWithdrawal {
  id: string;
  reference: string;
  campaignTitle: string;
  amountKobo: number;
  status: WithdrawalStatus;
  bankLabel: string;              // 'GTBank ••• 4821'
  requestedAt: string;
  note: string | null;
}

export type CreatorNotificationType =
  | 'CAMPAIGN_APPROVED'
  | 'CAMPAIGN_REJECTED'
  | 'CHANGES_REQUESTED'
  | 'CONTRIBUTION'
  | 'GOAL_MILESTONE'
  | 'WITHDRAWAL'
  | 'FRAUD_REVIEW';

export interface CreatorNotification {
  id: string;
  type: CreatorNotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface TrafficSource {
  source: string;                 // 'WhatsApp' | 'Direct' | ...
  visits: number;
  contributions: number;
}

export interface CampaignAnalytics {
  campaignId: string;
  views: number;
  shares: number;
  conversionRate: number;         // 0-100
  averageContributionKobo: number;
  dailyRaised: { date: string; raisedKobo: number }[];
  trafficSources: TrafficSource[];
}

// ─── Campaign creation (Section G) ────────────────────────────────────────────

export interface DraftBudgetItem {
  id: string;
  label: string;
  amountKobo: number;
}

export interface DraftRewardTier {
  id: string;
  title: string;
  amountKobo: number;
  description: string;
  requiresShipping: boolean;
}

export interface DraftMilestone {
  id: string;
  title: string;
  targetKobo: number;
}

/** Working draft accumulated across the multi-step creation wizard. */
export interface CampaignDraftInput {
  type: CampaignType | null;
  category: string | null;
  title: string;
  summary: string;
  story: string;
  coverImageUri: string | null;
  galleryUris: string[];
  videoUri: string | null;
  goalKobo: number;
  currency: 'NGN';
  deadline: string | null;        // ISO; null = no deadline
  location: string;
  beneficiaryName: string;
  beneficiaryRelationship: string;
  budget: DraftBudgetItem[];
  disbursementModel: DisbursementModel | null;
  milestones: DraftMilestone[];
  rewardTiers: DraftRewardTier[];
  documentLabels: string[];
  refundPolicy: string;
  acceptedPolicy: boolean;
}

export interface SubmitCampaignResult {
  campaignId: string;
  status: Extract<CampaignStatus, 'DRAFT' | 'PENDING_REVIEW'>;
  reference: string;
}

// ─── Owner self-management (Section G2) ───────────────────────────────────────

/**
 * Patch body for `PATCH /creator/campaigns/:id`. Every key is OPTIONAL and the
 * server applies subset semantics: an absent key is left unchanged. That is why
 * this is not `Partial<CampaignDraftInput>` — the wire contract distinguishes
 * "not supplied" from "cleared", so the edit screen must send only the fields
 * the owner actually touched.
 */
export interface CampaignEditInput {
  title?: string;
  summary?: string;
  story?: string;
  category?: string;
  coverImage?: string | null;
  goalKobo?: number;
}

// ─── Wallet, ledger & withdrawal (Section I) ──────────────────────────────────

export interface CampaignWalletSummary {
  campaignId: string;
  campaignTitle: string;
  availableKobo: number;
  pendingKobo: number;
  escrowKobo: number;
  totalRaisedKobo: number;
  totalWithdrawnKobo: number;
  frozen: boolean;
}

export type LedgerEntryType =
  | 'CONTRIBUTION'
  | 'WITHDRAWAL'
  | 'PLATFORM_FEE'
  | 'REFUND'
  | 'REVERSAL'
  | 'MILESTONE_RELEASE';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  description: string;
  amountKobo: number;        // signed: +credit / -debit
  balanceKobo: number;       // running balance after this entry
  reference: string;
  status: 'POSTED' | 'PENDING' | 'REVERSED';
  createdAt: string;
}

export interface WithdrawalRequestInput {
  campaignId: string;
  amountKobo: number;
  bankAccountId: string;
  reason: string;
  evidenceLabel: string | null;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumberMasked: string;   // '••• 4821'
  accountName: string;
  isDefault: boolean;
}

// ─── Support & disputes (Section O) ───────────────────────────────────────────

export type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';

export type TicketCategory =
  | 'CAMPAIGN'
  | 'PAYMENT'
  | 'REFUND'
  | 'REWARD'
  | 'FAKE_CAMPAIGN'
  | 'WITHDRAWAL'
  | 'OTHER';

export interface TicketMessage {
  id: string;
  from: 'user' | 'support';
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  reference: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface CreateTicketInput {
  category: TicketCategory;
  subject: string;
  body: string;
}

export interface HelpArticle {
  id: string;
  question: string;
  answer: string;
  topic: string;
}

// ─── Notifications (Section N) ────────────────────────────────────────────────

export type AppNotificationType =
  | 'CONTRIBUTION_RECEIVED'
  | 'GOAL_MILESTONE'
  | 'CAMPAIGN_UPDATE'
  | 'WITHDRAWAL_STATUS'
  | 'REFUND_STATUS'
  | 'REWARD_UPDATE'
  | 'CAMPAIGN_APPROVED'
  | 'SUPPORT_REPLY';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  campaignId: string | null;
}

// ─── Reward fulfilment (Section K) ────────────────────────────────────────────

export type RewardFulfilmentStatus =
  | 'PENDING_PRODUCTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DELAYED'
  | 'CANCELLED';

export interface RewardBacker {
  id: string;
  backerName: string;
  rewardTierTitle: string;
  amountKobo: number;
  status: RewardFulfilmentStatus;
  shippingCity: string | null;
  requiresShipping: boolean;
  claimedAt: string;
}

// ─── Settings (Section P) ─────────────────────────────────────────────────────

export interface NotificationPrefs {
  push: boolean;
  email: boolean;
  sms: boolean;
  contributionAlerts: boolean;
  campaignUpdates: boolean;
  marketing: boolean;
}

// ─── Updates & communication (Section H) ──────────────────────────────────────

export interface CommentReply {
  id: string;
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
  isQuestion: boolean;       // Q&A vs. general comment
  isCreator: boolean;
  reported: boolean;
  replies: CommentReply[];
}

export interface PostUpdateInput {
  campaignId: string;
  title: string;
  body: string;
  imageUri: string | null;
}

export interface BroadcastInput {
  campaignId: string;
  subject: string;
  body: string;
  channelPush: boolean;
  channelEmail: boolean;
}

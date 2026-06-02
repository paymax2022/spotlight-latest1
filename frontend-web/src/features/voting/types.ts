// =============================================================================
// UNIVERSAL VOTING ENGINE — TypeScript Types
// =============================================================================

// ---------------------------------------------------------------------------
// Enums / union literals
// ---------------------------------------------------------------------------
export type VotingType = 'free' | 'paid' | 'hybrid';
export type VoteLimitScope = 'user' | 'email' | 'phone' | 'device' | 'ip' | 'session';
export type PaymentProvider = 'paystack' | 'flutterwave' | 'monnify' | 'squad';
export type VotingStatus = 'draft' | 'active' | 'paused' | 'closed';

export type VoteType =
  | 'free'
  | 'paid'
  | 'bonus'
  | 'admin_adjustment'
  | 'sponsor_bundle'
  | 'refund_reversal'
  | 'fraud_reversal';

export type VoteStatus = 'pending' | 'confirmed' | 'rejected' | 'reversed' | 'quarantined' | 'failed';

export type PaymentStatus =
  | 'pending'
  | 'successful'
  | 'failed'
  | 'abandoned'
  | 'refunded'
  | 'chargeback';

export type VoteCreditStatus = 'pending' | 'credited' | 'skipped' | 'reversed';

export type FraudStatus = 'clean' | 'suspicious' | 'flagged' | 'quarantined' | 'cleared';

export type FraudFlagType =
  | 'duplicate_ip'
  | 'duplicate_device'
  | 'bot_speed'
  | 'vote_spike'
  | 'suspicious_payment'
  | 'duplicate_webhook'
  | 'self_vote'
  | 'disposable_email'
  | 'vpn_proxy'
  | 'suspicious_phone'
  | 'location_mismatch'
  | 'high_volume_account'
  | 'vote_farming';

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudFlagStatus = 'open' | 'under_review' | 'resolved' | 'dismissed' | 'actioned';

export type RoundType =
  | 'prequalification'
  | 'top50'
  | 'top20'
  | 'top10'
  | 'eviction'
  | 'wildcard'
  | 'finale'
  | 'fan_favorite'
  | 'sponsor'
  | 'standard';

export type RoundStatus = 'upcoming' | 'active' | 'closed' | 'results_published';

export type AdminAdjustmentType = 'add' | 'subtract' | 'reverse' | 'quarantine' | 'restore';
export type ShareEventType = 'click' | 'share' | 'vote' | 'paid_vote';
export type LeaderboardScope = 'overall' | 'category' | 'region' | 'gender';
export type TieBreakerRule = 'first_milestone' | 'paid_votes' | 'free_votes' | 'judge_score' | 'admin';

// ---------------------------------------------------------------------------
// Voting Settings
// ---------------------------------------------------------------------------
export interface VotingSettings {
  id: string;
  contestId: string;
  votingEnabled: boolean;
  votingType: VotingType;

  // Free voting
  freeVotingEnabled: boolean;
  freeVotesPerDay: number;
  freeVotesPerContest: number | null;
  freeVotesPerContestant: number | null;
  freeVoteResetTime: string;
  freeVoteLimitScope: VoteLimitScope;
  allowAnonymousFreeVote: boolean;
  requireLoginForFreeVote: boolean;
  requirePhoneForFreeVote: boolean;
  requireEmailForFreeVote: boolean;
  requireCaptcha: boolean;
  voteCooldownSeconds: number;
  maxFailedAttempts: number;

  // Paid voting
  paidVotingEnabled: boolean;
  currency: string;
  paymentProvider: PaymentProvider;
  allowCustomVoteQuantity: boolean;
  minPaidVotes: number;
  maxPaidVotesPerTxn: number;
  paymentRefPrefix: string;
  applyPaymentFeesToUser: boolean;
  refundPolicy: string | null;

  // Visibility
  showPublicVoteCount: boolean;
  showPublicLeaderboard: boolean;
  showPublicRank: boolean;
  allowVoteSharing: boolean;

  // Window
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  timezone: string;

  // Leaderboard
  leaderboardFreezeEnabled: boolean;
  leaderboardFreezeAt: string | null;
  leaderboardScope: LeaderboardScope;
  leaderboardTieBreaker: TieBreakerRule;
  showTopN: number | null;

  // Fraud
  fraudDetectionEnabled: boolean;
  suspiciousIpLimit: number;
  botSpeedThresholdMs: number;
  blockDisposableEmails: boolean;
  detectVoteSpikes: boolean;
  enableVoteQuarantine: boolean;
  enableManualAudit: boolean;

  status: VotingStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Vote Package
// ---------------------------------------------------------------------------
export interface VotePackage {
  id: string;
  contestId: string;
  name: string;
  description: string | null;
  votes: number;
  bonusVotes: number;
  totalVotes: number;     // votes + bonusVotes, computed
  amount: number;
  currency: string;
  isActive: boolean;
  isRecommended: boolean;
  promoLabel: string | null;
  displayOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Voter Profile
// ---------------------------------------------------------------------------
export interface VoterProfile {
  id: string;
  userId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  deviceFingerprint: string | null;
  ipAddress: string | null;
  isAnonymous: boolean;
  isVerified: boolean;
  bannedAt: string | null;
  banReason: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------
export interface Vote {
  id: string;
  contestId: string;
  contestantId: string;
  voterProfileId: string | null;
  voterUserId: string | null;
  voteType: VoteType;
  voteQuantity: number;
  voteStatus: VoteStatus;
  transactionId: string | null;
  paymentReference: string | null;
  roundId: string | null;
  ipAddress: string | null;
  deviceFingerprint: string | null;
  userAgent: string | null;
  source: string | null;
  shareCode: string | null;
  fraudScore: number;
  fraudStatus: FraudStatus;
  createdAt: string;
  confirmedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

// ---------------------------------------------------------------------------
// Vote Transaction
// ---------------------------------------------------------------------------
export interface VoteTransaction {
  id: string;
  contestId: string;
  contestantId: string;
  voterProfileId: string | null;
  voterUserId: string | null;
  votePackageId: string | null;
  paymentProvider: PaymentProvider;
  paymentReference: string;
  providerReference: string | null;
  amountExpected: number;
  amountPaid: number | null;
  currency: string;
  votesPurchased: number;
  bonusVotes: number;
  totalVotesToCredit: number;
  paymentStatus: PaymentStatus;
  voteCreditStatus: VoteCreditStatus;
  idempotencyKey: string | null;
  voterEmail: string | null;
  voterName: string | null;
  metadata: Record<string, unknown>;
  paidAt: string | null;
  verifiedAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Vote Totals (per contestant per contest)
// ---------------------------------------------------------------------------
export interface VoteTotals {
  id: string;
  contestId: string;
  contestantId: string;
  roundId: string | null;
  freeVotes: number;
  paidVotes: number;
  bonusVotes: number;
  adminAdjustmentVotes: number;
  reversedVotes: number;
  quarantinedVotes: number;
  totalConfirmedVotes: number;
  rank: number | null;
  lastVoteAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Voter Daily Limits
// ---------------------------------------------------------------------------
export interface VoterDailyLimit {
  id: string;
  contestId: string;
  voterIdentifier: string;
  voterIdentifierType: VoteLimitScope;
  voteDate: string;
  freeVotesUsed: number;
  freeVotesLimit: number;
  lastVoteAt: string | null;
}

// ---------------------------------------------------------------------------
// Contestant Share Link
// ---------------------------------------------------------------------------
export interface ContestantShareLink {
  id: string;
  contestId: string;
  contestantId: string;
  shareCode: string;
  shareUrl: string;
  qrCodeUrl: string | null;
  clickCount: number;
  voteCount: number;
  paidVoteCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Leaderboard Entry
// ---------------------------------------------------------------------------
export interface LeaderboardEntry {
  rank: number;
  contestantId: string;
  contestantName: string;
  stageName: string | null;
  photoUrl: string | null;
  category: string | null;
  state: string | null;
  totalConfirmedVotes: number;
  freeVotes: number;
  paidVotes: number;
  lastVoteAt: string | null;
  shareCode: string | null;
  shareUrl: string | null;
}

// ---------------------------------------------------------------------------
// Fraud Flag
// ---------------------------------------------------------------------------
export interface FraudFlag {
  id: string;
  contestId: string;
  contestantId: string | null;
  voterProfileId: string | null;
  voteId: string | null;
  transactionId: string | null;
  flagType: FraudFlagType;
  severity: FraudSeverity;
  description: string;
  status: FraudFlagStatus;
  actionTaken: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Voting Round
// ---------------------------------------------------------------------------
export interface VotingRound {
  id: string;
  contestId: string;
  name: string;
  slug: string;
  roundNumber: number;
  roundType: RoundType;
  votingType: VotingType;
  freeVotesPerDay: number | null;
  carryForwardVotes: boolean;
  resetVotes: boolean;
  voteWeight: number;
  judgeScoreWeight: number;
  publicVoteWeight: number;
  eliminationCount: number | null;
  qualificationCount: number | null;
  status: RoundStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Vote Receipt
// ---------------------------------------------------------------------------
export interface VoteReceipt {
  id: string;
  transactionId: string;
  contestId: string;
  contestantId: string;
  voterEmail: string | null;
  voterName: string | null;
  receiptNumber: string;
  votesPurchased: number;
  bonusVotes: number;
  amountPaid: number;
  currency: string;
  paymentRef: string;
  issuedAt: string;
}

// ---------------------------------------------------------------------------
// Admin Vote Adjustment
// ---------------------------------------------------------------------------
export interface AdminVoteAdjustment {
  id: string;
  contestId: string;
  contestantId: string;
  adminId: string;
  approvedBy: string | null;
  adjustmentType: AdminAdjustmentType;
  voteQuantity: number;
  reason: string;
  beforeTotal: number;
  afterTotal: number;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  appliedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Revenue Summary (for admin revenue dashboard)
// ---------------------------------------------------------------------------
export interface VotingRevenueSummary {
  contestId: string;
  totalRevenue: number;
  currency: string;
  successfulTransactions: number;
  failedTransactions: number;
  pendingTransactions: number;
  refundedTransactions: number;
  totalVotesSold: number;
  averageTransactionValue: number;
  conversionRate: number;  // free voters who also bought paid votes
  dailyRevenue: { date: string; revenue: number; transactions: number }[];
  revenueByPackage: { packageId: string; packageName: string; revenue: number; count: number }[];
}

// ---------------------------------------------------------------------------
// Request/Response DTOs
// ---------------------------------------------------------------------------

export interface CastFreeVoteRequest {
  contestId: string;
  contestantId: string;
  voteQuantity?: number;        // defaults to 1
  voterIdentifier?: string;     // phone / email for non-logged-in voters
  captchaToken?: string;
  shareCode?: string;
}

export interface CastFreeVoteResponse {
  success: boolean;
  votesAdded: number;
  totalFreeVotesUsed: number;
  freeVotesRemaining: number;
  newTotalVotes: number;
  fraudStatus: FraudStatus;
}

export interface InitiatePaidVoteRequest {
  contestId: string;
  contestantId: string;
  packageId?: string;            // use a preset package
  customVoteQuantity?: number;   // if allowCustomVoteQuantity is true
  voterEmail: string;
  voterName: string;
  voterPhone?: string;
  shareCode?: string;
  callbackUrl?: string;
}

export interface InitiatePaidVoteResponse {
  transactionId: string;
  paymentReference: string;
  authorizationUrl: string;     // redirect to payment page
  amountExpected: number;
  currency: string;
  votesToCredit: number;
  bonusVotes: number;
}

export interface VerifyPaidVoteRequest {
  transactionId: string;
  paymentReference: string;
}

export interface VerifyPaidVoteResponse {
  success: boolean;
  alreadyProcessed: boolean;
  votesCredited: number;
  newTotalVotes: number;
  receiptNumber: string | null;
}

export interface RemainingFreeVotesResponse {
  contestId: string;
  freeVotesPerDay: number;
  freeVotesUsed: number;
  freeVotesRemaining: number;
  resetAt: string;              // ISO timestamp of next reset
  nextResetHours: number;
}

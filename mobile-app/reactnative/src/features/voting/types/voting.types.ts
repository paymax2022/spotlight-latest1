export type ContestStatus =
  | 'UPCOMING'
  | 'LIVE'
  | 'PAUSED'
  | 'CLOSED'
  | 'RESULTS_PUBLISHED';

export type ContestantStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'ELIMINATED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'WINNER'
  | 'RUNNER_UP'
  | 'HIDDEN';

export type VoteType = 'FREE' | 'PAID';

export type VoteTransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'REFUNDED'
  | 'REVERSED';

export interface Contest {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: ContestStatus;
  bannerImage?: string;
  contestantCount: number;
  /**
   * Total votes for the contest. May be `null` when the admin has hidden vote
   * counts for this contest/phase (`showVoteCount === false`).
   */
  totalVotes: number | null;
  startsAt?: string;
  endsAt?: string;
  freeVotesPerDay: number;
  paidVotingEnabled: boolean;
  sponsorName?: string;
  sponsorLogo?: string;
  prizes?: string[];
  rules?: string[];
  /**
   * Admin visibility flags. All default to `true` when undefined so existing
   * contests are unaffected. Resolve with `resolveContestVisibility`.
   */
  /** When false, hide ALL vote-count numbers for this contest. */
  showVoteCount?: boolean;
  /** When false, hide the leaderboard surface entirely. */
  showLeaderboard?: boolean;
  /** When false, hide rank/position badges. */
  showRank?: boolean;
  /** Optional label (e.g. "Auditions") explaining why something is hidden. */
  activePhaseLabel?: string | null;
}

export interface Contestant {
  id: string;
  contestId: string;
  name: string;
  stageName?: string;
  category?: string;
  state?: string;
  photo?: string;
  mediaUrl?: string;
  rank: number;
  /**
   * Contestant vote count. May be `null` when vote counts are hidden for the
   * contest (`showVoteCount === false`).
   */
  votes: number | null;
  bio?: string;
  isVerified?: boolean;
  status: ContestantStatus;
  votesNeededToNextRank?: number;
  movement?: 'UP' | 'DOWN' | 'SAME';
  profileViews?: number;
  shareClicks?: number;
}

export interface VotePackage {
  id: string;
  votes: number;
  amount: number;
  currency: 'NGN';
  label?: string;
  bonusVotes?: number;
  isPopular?: boolean;
  isBestValue?: boolean;
}

export interface VoteTransaction {
  id: string;
  contestId: string;
  contestantId: string;
  contestantName?: string;
  contestTitle?: string;
  voteType: VoteType;
  votes: number;
  amount?: number;
  currency?: 'NGN';
  status: VoteTransactionStatus;
  reference: string;
  createdAt: string;
}

export interface FreeVoteAllocation {
  total: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

/**
 * Direction of a contestant's rank movement as reported by the leaderboard
 * endpoint. The API emits lowercase `rankChange` ('up' | 'down' | 'same').
 */
export type RankChange = 'up' | 'down' | 'same';

export interface LeaderboardEntry {
  rank: number;
  contestant: Contestant;
  previousRank?: number;
  movement?: 'UP' | 'DOWN' | 'SAME';
  /** Raw trend signal from the endpoint. Preferred source for trend arrows. */
  rankChange?: RankChange;
}

/**
 * Leaderboard payload that also carries whether the admin has hidden the board.
 * When `hidden` is true, `entries` is empty and `reason` may explain why.
 */
export interface LeaderboardState {
  hidden: boolean;
  reason?: string | null;
  entries: LeaderboardEntry[];
}

export interface VotingNotification {
  id: string;
  type:
    | 'FREE_VOTES_RESET'
    | 'VOTING_LIVE'
    | 'CONTEST_ENDING'
    | 'RANK_CHANGED'
    | 'VOTE_SUCCESS'
    | 'PAYMENT_FAILED'
    | 'RESULTS_PUBLISHED';
  title: string;
  message: string;
  contestId?: string;
  contestantId?: string;
  createdAt: string;
  read: boolean;
}

export interface VoteFreePayload {
  contestantId: string;
  contestId: string;
  votes: number;
  idempotencyKey: string;
}

export interface VotePaidInitiatePayload {
  contestantId: string;
  contestId: string;
  packageId?: string;
  /** Sent as `customVoteQuantity` when no packageId is supplied. */
  votes: number;
  amount: number;
  paymentMethod: PaymentMethod;
  /** Required by the backend; sourced from the authenticated user's profile. */
  voterEmail: string;
  voterName: string;
  idempotencyKey: string;
}

export type PaymentMethod = 'WALLET' | 'CARD' | 'BANK_TRANSFER' | 'USSD';

export interface VotePaidInitiateResult {
  /** Backend transaction id used for verification. */
  transactionId: string;
  /** Paystack payment reference used for verification. */
  reference: string;
  /** Paystack-hosted checkout URL (opened for non-wallet methods). */
  authorizationUrl?: string;
  amountExpected?: number;
  votesToCredit?: number;
  bonusVotes?: number;
  status: VoteTransactionStatus;
}

export interface VotePaidVerifyResult {
  status: VoteTransactionStatus;
  votes?: number;
  newTotalVotes?: number;
  receiptNumber?: string | null;
}

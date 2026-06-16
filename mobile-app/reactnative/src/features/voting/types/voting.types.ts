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
  totalVotes: number;
  startsAt?: string;
  endsAt?: string;
  freeVotesPerDay: number;
  paidVotingEnabled: boolean;
  sponsorName?: string;
  sponsorLogo?: string;
  prizes?: string[];
  rules?: string[];
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
  votes: number;
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

export interface LeaderboardEntry {
  rank: number;
  contestant: Contestant;
  previousRank?: number;
  movement?: 'UP' | 'DOWN' | 'SAME';
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
  votes: number;
  amount: number;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
}

export type PaymentMethod = 'WALLET' | 'CARD' | 'BANK_TRANSFER' | 'USSD';

export interface VotePaidInitiateResult {
  reference: string;
  authorizationUrl?: string;
  status: VoteTransactionStatus;
}

export const VOTING_DEFAULTS = {
  FREE_VOTES_PER_DAY: 3,
  FREE_VOTE_RESET_TIME: '00:00:00',
  FREE_VOTE_LIMIT_SCOPE: 'user' as const,
  CURRENCY: 'NGN',
  PAYMENT_PROVIDER: 'paystack' as const,
  MIN_PAID_VOTES: 1,
  MAX_PAID_VOTES_PER_TXN: 10_000,
  PAYMENT_REF_PREFIX: 'SPT-VOTE',
  BOT_SPEED_THRESHOLD_MS: 500,
  SUSPICIOUS_IP_LIMIT: 20,
  VOTE_COOLDOWN_SECONDS: 0,
  MAX_FAILED_ATTEMPTS: 10,
  TIMEZONE: 'Africa/Lagos',
};

export const VOTE_PACKAGE_PRESETS = [
  { name: 'Starter Pack',    votes: 10,  bonusVotes: 0,   amount: 1000  },
  { name: 'Supporter Pack',  votes: 50,  bonusVotes: 0,   amount: 5000  },
  { name: 'Super Fan Pack',  votes: 100, bonusVotes: 0,   amount: 10000 },
  { name: 'Mega Fan Pack',   votes: 500, bonusVotes: 0,   amount: 50000 },
] as const;

export const FRAUD_SCORE_THRESHOLDS = {
  CLEAN: 0,
  SUSPICIOUS: 30,
  FLAGGED: 60,
  QUARANTINE: 80,
} as const;

export const LEADERBOARD_CACHE_TTL_SECONDS = 30;

export const RECEIPT_PREFIX = 'SPT-RCP';

export const SHARE_CODE_LENGTH = 8;

export const SHARE_CHANNELS = ['whatsapp', 'instagram', 'twitter', 'facebook', 'tiktok', 'copy', 'qr'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const SHARE_MESSAGE_TEMPLATE = (
  contestantName: string,
  contestName: string,
  voteUrl: string,
) =>
  `Please vote for ${contestantName} on ${contestName}. Your vote means the world!\n\nVote here: ${voteUrl}`;

export const ROUND_TYPE_LABELS: Record<string, string> = {
  prequalification: 'Prequalification Round',
  top50: 'Top 50',
  top20: 'Top 20',
  top10: 'Top 10',
  eviction: 'Eviction Round',
  wildcard: 'Wildcard',
  finale: 'Grand Finale',
  fan_favorite: 'Fan Favourite',
  sponsor: 'Sponsor Vote',
  standard: 'Voting Round',
};

export const VOTE_TYPE_LABELS: Record<string, string> = {
  free: 'Free Vote',
  paid: 'Paid Vote',
  bonus: 'Bonus Vote',
  admin_adjustment: 'Admin Adjustment',
  sponsor_bundle: 'Sponsor Bundle',
  refund_reversal: 'Refund Reversal',
  fraud_reversal: 'Fraud Reversal',
};

export const FORMAT_NAIRA = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);

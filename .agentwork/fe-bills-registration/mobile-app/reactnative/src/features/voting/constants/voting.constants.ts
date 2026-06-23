import { Colors } from '@/constants/colors';

// Extended color tokens for voting module
export const VotingColors = {
  // Rank medals
  rankGold:   '#F59E0B',
  rankSilver: '#94A3B8',
  rankBronze: '#CD7F32',

  // Contest status
  contestLive:    '#10B981',
  contestLiveBg:  'rgba(16, 185, 129, 0.12)',
  contestUpcoming: '#F59E0B',
  contestUpcomingBg: 'rgba(245, 158, 11, 0.12)',
  contestClosed:  Colors.outline,
  contestClosedBg: 'rgba(123, 116, 131, 0.12)',
  contestPaused:  '#F97316',
  contestPausedBg: 'rgba(249, 115, 22, 0.12)',

  // Vote types
  freeVote:    Colors.teal,
  freeVoteBg:  Colors.iconBgTeal,
  paidVote:    Colors.secondary,
  paidVoteBg:  Colors.iconBgBlue,

  // Spotight gold (premium CTA)
  spotlightGold:   '#F59E0B',
  spotlightGoldBg: 'rgba(245,158,11,0.12)',

  // Leaderboard bg
  podiumGoldBg:   'rgba(245,158,11,0.10)',
  podiumSilverBg: 'rgba(148,163,184,0.10)',
  podiumBronzeBg: 'rgba(205,127,50,0.10)',
} as const;

export const FREE_VOTES_PER_DAY = 5;

export const VOTE_STATUS_LABELS: Record<string, string> = {
  PENDING:    'Pending',
  PROCESSING: 'Processing',
  SUCCESSFUL: 'Successful',
  FAILED:     'Failed',
  REFUNDED:   'Refunded',
  REVERSED:   'Reversed',
};

export const CONTEST_STATUS_LABELS: Record<string, string> = {
  UPCOMING:          'Upcoming',
  LIVE:              'Live',
  PAUSED:            'Paused',
  CLOSED:            'Closed',
  RESULTS_PUBLISHED: 'Results',
};

export const PAYMENT_METHODS = [
  { id: 'WALLET',        label: 'Wallet Balance', icon: 'Wallet',       description: 'Pay from your Paymax wallet' },
  { id: 'CARD',          label: 'Debit Card',     icon: 'CreditCard',   description: 'Visa, Mastercard accepted' },
  { id: 'BANK_TRANSFER', label: 'Bank Transfer',  icon: 'Building2',    description: 'Direct bank transfer' },
  { id: 'USSD',          label: 'USSD',           icon: 'Hash',         description: 'Pay via USSD code' },
] as const;

export const VOTING_RULES = [
  {
    title: 'Free Voting',
    rules: [
      `You get ${FREE_VOTES_PER_DAY} free votes per day per contest.`,
      'Free votes reset daily at midnight (WAT).',
      'Free votes cannot be transferred or accumulated.',
      'One account per person — duplicate accounts will be disqualified.',
    ],
  },
  {
    title: 'Paid Voting',
    rules: [
      'Purchase vote packages to cast additional votes instantly.',
      'Paid votes are applied immediately after payment confirmation.',
      'All prices are in Naira (NGN) and are non-refundable once votes are cast.',
      'Contact support within 24 hours for payment issues.',
    ],
  },
  {
    title: 'Refund Policy',
    rules: [
      'Votes already cast cannot be refunded.',
      'If payment is deducted but votes are not credited, contact support within 48 hours.',
      'Refunds for technical errors are processed within 3–5 business days.',
    ],
  },
  {
    title: 'Anti-Fraud',
    rules: [
      'Automated/bot voting is strictly prohibited and will result in disqualification.',
      'Buying/selling votes is not allowed.',
      'Spotlight reserves the right to disqualify any contestant found to be engaging in vote manipulation.',
    ],
  },
];

// ── Crowdfunding — Constants ─────────────────────────────────────────────────

import type {
  CampaignCategory,
  CampaignSort,
  PaymentMethod,
} from '../types/crowdfunding.types';

export const CAMPAIGN_CATEGORIES: CampaignCategory[] = [
  { id: 'cat-med',  slug: 'medical',   label: 'Medical',   icon: 'HeartPulse',  tint: 'red',    campaignCount: 312 },
  { id: 'cat-edu',  slug: 'education', label: 'Education',  icon: 'GraduationCap', tint: 'blue', campaignCount: 248 },
  { id: 'cat-cre',  slug: 'creative',  label: 'Creative',  icon: 'Palette',     tint: 'purple', campaignCount: 176 },
  { id: 'cat-sme',  slug: 'sme',       label: 'SME',       icon: 'Store',       tint: 'orange', campaignCount: 134 },
  { id: 'cat-ngo',  slug: 'ngo',       label: 'NGO',       icon: 'HandHeart',   tint: 'teal',   campaignCount: 98  },
  { id: 'cat-rel',  slug: 'religious', label: 'Religious', icon: 'Church',      tint: 'purple', campaignCount: 87  },
  { id: 'cat-com',  slug: 'community', label: 'Community', icon: 'Users',       tint: 'green',  campaignCount: 142 },
  { id: 'cat-eme',  slug: 'emergency', label: 'Emergency', icon: 'Siren',       tint: 'red',    campaignCount: 64  },
  { id: 'cat-rew',  slug: 'reward',    label: 'Reward',    icon: 'Gift',        tint: 'orange', campaignCount: 71  },
  { id: 'cat-inv',  slug: 'investment', label: 'Investment', icon: 'TrendingUp', tint: 'teal',  campaignCount: 12  },
];

/** Investment crowdfunding is feature-flagged off until licensed (see playbook §7.9). */
export const INVESTMENT_ENABLED = false;

/** Corporate CSR / matching donations — feature-flagged off until partner onboarding. */
export const CSR_ENABLED = false;

export const SORT_OPTIONS: { value: CampaignSort; label: string; icon: string }[] = [
  { value: 'recommended', label: 'Recommended',          icon: 'Sparkles' },
  { value: 'trending',    label: 'Trending now',          icon: 'Flame' },
  { value: 'newest',      label: 'Newest first',          icon: 'Clock' },
  { value: 'ending_soon', label: 'Ending soon',           icon: 'TimerReset' },
  { value: 'most_funded', label: 'Most funded',           icon: 'TrendingUp' },
  { value: 'least_funded', label: 'Needs help (least funded)', icon: 'TrendingDown' },
];

/** Suggested contribution amounts, in kobo (₦500, ₦1k, ₦2k, ₦5k, ₦10k, ₦20k). */
export const SUGGESTED_AMOUNTS_KOBO = [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000];

export const MIN_CONTRIBUTION_KOBO = 10_000;   // ₦100
export const MAX_CONTRIBUTION_KOBO = 500_000_000; // ₦5,000,000

export const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
  description: string;
  icon: string;
}[] = [
  { value: 'WALLET',        label: 'Spotlight Wallet', description: 'Pay instantly from your balance', icon: 'Wallet' },
  { value: 'CARD',          label: 'Debit / Credit Card', description: 'Visa, Mastercard, Verve',     icon: 'CreditCard' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer',    description: 'Transfer to a one-time account',  icon: 'Landmark' },
  { value: 'USSD',          label: 'USSD',             description: 'Dial a code to pay from any bank', icon: 'Hash' },
];

/** Platform fee = 2.5% of contribution; payment processing = 1.5% + ₦100 flat. */
export const PLATFORM_FEE_BPS = 250;   // basis points (2.5%)
export const PAYMENT_FEE_BPS = 150;    // 1.5%
export const PAYMENT_FEE_FLAT_KOBO = 10_000; // ₦100

export const CROWDFUNDING_FEATURE_FLAG = 'crowdfunding';

// ── Spotlight Wealth — Constants ─────────────────────────────────────────────
// Feature flag, topic → chip styling (design tokens only), and the education /
// no-advice disclaimers that keep this surface education-first (never hype).
// All colours/spacing come from the shared design tokens — nothing hard-coded.

import { Colors } from '@/constants/colors';
import type { ChallengeKind, SpotlightTopic } from '../types/spotlight.types';

/** Feature flag gating the whole Spotlight Wealth surface (every growth surface flagged). */
export const SPOTLIGHT_FEATURE_FLAG = 'spotlight_wealth';

/** Default reward-wallet currency for the MVP (NGN-first). */
export const DEFAULT_CURRENCY = 'NGN';

/** Currency display metadata (symbol + fraction digits). */
export const CURRENCY_META: Record<string, { symbol: string; decimals: number }> = {
  NGN: { symbol: '₦', decimals: 0 },
  USD: { symbol: '$', decimals: 2 },
};

// ─── Topic → chip styling (design tokens only) ────────────────────────────────

export const TOPIC_STYLE: Record<SpotlightTopic, { label: string; fg: string; bg: string }> = {
  'budgeting':        { label: 'Budgeting',        fg: Colors.secondary,             bg: Colors.iconBgBlue },
  'investing-basics': { label: 'Investing basics', fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  'crypto':           { label: 'Crypto',           fg: Colors.onWarning,             bg: Colors.iconBgGold },
  'stocks':           { label: 'Stocks',           fg: Colors.tertiaryContainer,     bg: Colors.iconBgTeal },
  'saving':           { label: 'Saving',           fg: Colors.tertiaryContainer,     bg: Colors.iconBgGreen },
  'mindset':          { label: 'Money mindset',    fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
};

/** Ordered topic list for the videos filter (with an "All" affordance built in screen). */
export const TOPIC_ORDER: SpotlightTopic[] = [
  'budgeting',
  'investing-basics',
  'crypto',
  'stocks',
  'saving',
  'mindset',
];

// ─── Challenge kind → label + lucide icon name ────────────────────────────────

export const CHALLENGE_KIND_META: Record<ChallengeKind, { label: string; icon: string; fg: string; bg: string }> = {
  literacy: { label: 'Literacy',  icon: 'BookOpen',     fg: Colors.secondary,         bg: Colors.iconBgBlue },
  quiz:     { label: 'Quiz',      icon: 'HelpCircle',   fg: Colors.onPrimaryFixedVariant, bg: Colors.iconBgPurple },
  savings:  { label: 'Savings',   icon: 'PiggyBank',    fg: Colors.tertiaryContainer, bg: Colors.iconBgGreen },
};

// ─── Education-first disclaimers (docs/crypto/product.md → strict rules) ───────

/** Shown wherever creator finance content appears. */
export const CREATOR_DISCLAIMER =
  'Educational content, not investment advice; creators are not recommending securities.';

/** Shown on every challenge / reward so credit is never read as guaranteed return. */
export const REWARD_DISCLAIMER =
  'Rewards are credited to your Spotlight reward wallet — they are not a guaranteed investment return.';

/** Shown on the learning leaderboard so points are never confused with profit. */
export const LEADERBOARD_DISCLAIMER =
  'Ranks are based on learning points from lessons and quizzes — not trading profit or gains.';

/** General Spotlight Wealth promise line for the hero / about copy. */
export const WEALTH_TAGLINE = 'Learn. Earn credit. Grow your money knowledge.';

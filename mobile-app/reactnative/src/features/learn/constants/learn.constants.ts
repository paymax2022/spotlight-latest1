// ── Paymax Invest · Learn Center — Constants ─────────────────────────────────
// Level styling + education disclosures + UI thresholds. Colors come from the
// brand palette only (Rule: nothing invented at the call site).

import { Colors } from '@/constants/colors';
import type { LearnLevel } from '../types/learn.types';

/** Feature flag gating the whole Learn surface (every module sits behind a flag). */
export const LEARN_FEATURE_FLAG = 'invest_learn';

/** Fraction of questions a learner must get right to pass a quiz. */
export const QUIZ_PASS_RATIO = 0.7;

/**
 * Per-level chip + glyph styling. `tint` is the glyph color, `bg` the soft
 * tint background — both pulled from design tokens so nothing is hard-coded.
 */
export const LEVEL_STYLE: Record<
  LearnLevel,
  { label: string; tint: string; bg: string }
> = {
  beginner: { label: 'Beginner',        tint: Colors.teal,      bg: Colors.iconBgTeal },
  stock:    { label: 'Stocks',          tint: Colors.secondary, bg: Colors.iconBgBlue },
  crypto:   { label: 'Crypto',          tint: Colors.primary,   bg: Colors.iconBgPurple },
  wealth:   { label: 'Spotlight Wealth', tint: Colors.gold,     bg: Colors.iconBgGold },
};

/** Ordered tracks for the filter row on the Learn home. */
export const LEVEL_FILTERS: { value: LearnLevel | 'all'; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'stock',    label: 'Stocks' },
  { value: 'crypto',   label: 'Crypto' },
  { value: 'wealth',   label: 'Wealth' },
];

/** Education-first disclosures surfaced across the Learn screens. */
export const LEARN_DISCLOSURES = {
  educational:
    'This content is for educational purposes only and is not financial advice. Investing carries risk, including the possible loss of your capital.',
  pastPerformance:
    'Past performance is not a reliable indicator of future results.',
} as const;

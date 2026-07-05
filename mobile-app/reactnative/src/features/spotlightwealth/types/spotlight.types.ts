// ── Spotlight Wealth — Type Contract ─────────────────────────────────────────
// The education-first Spotlight ⇄ Invest growth surface (Phase-5 in
// docs/crypto/product.md). Mirrors the crypto module's typed-contract +
// mock-flagged-API conventions.
//
// STRICT RULES honoured here (docs/crypto/product.md → "Spotlight Integration"):
//  • Entertainment reach is used for EDUCATION and TRUST, never hype.
//  • Leaderboards rank LEARNING points (lessons/quizzes) — never profit/gains.
//  • Contest/challenge rewards are WALLET CREDIT — never a guaranteed
//    investment return, never an implied profit.
//  • No celebrity buy-signals, no "buy what your favourite artist buys".
//
// Money here is a plain { amount, currency } pair for display reward credits —
// this surface never executes trades, so it deliberately avoids the crypto
// module's minor-unit trade machinery.

/** A display money pair for reward wallet credit. `amount` is in major units. */
export interface Money {
  amount: number;
  currency: string; // ISO-4217 e.g. 'NGN' | 'USD'
}

/** Topics a finance video / challenge can be tagged with (drives chip styling). */
export type SpotlightTopic =
  | 'budgeting'
  | 'investing-basics'
  | 'crypto'
  | 'stocks'
  | 'saving'
  | 'mindset';

/**
 * A creator-led financial-literacy video. `thumbnailColor` is a brand-palette
 * token used to tint the placeholder thumbnail (no real media in the mock).
 * Creators provide EDUCATION — they never recommend specific securities.
 */
export interface FinanceVideo {
  id: string;
  title: string;
  creator: string;
  thumbnailColor: string; // brand-palette token for the thumbnail tile
  durationMins: number;
  topic: SpotlightTopic;
}

/** What kind of activity a challenge is built around (all education-first). */
export type ChallengeKind = 'literacy' | 'quiz' | 'savings';

/**
 * A learn-and-earn / literacy challenge. `reward` is always credited to the
 * user's reward WALLET on completion — it is NOT a guaranteed investment return
 * and must never be framed as profit.
 */
export interface Challenge {
  id: string;
  title: string;
  description: string;
  reward: Money;        // wallet credit on completion (never guaranteed return)
  endsAt: string;       // ISO timestamp
  joined: boolean;
  kind: ChallengeKind;
}

/**
 * A leaderboard row. `points` are LEARNING points earned from lessons and
 * quizzes — explicitly NOT trading profit or portfolio gains. We never rank
 * users by money made (docs: "no profit leaderboards").
 */
export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  points: number;       // LEARNING points (lessons/quizzes) — not profit
}

/** A single credit/spend movement in the reward wallet history. */
export interface RewardWalletEntry {
  id: string;
  label: string;
  amount: Money;        // positive = credit earned, negative = redeemed
  at: string;           // ISO timestamp
}

/** The user's reward wallet — credit earned from learning, plus its history. */
export interface RewardWallet {
  balance: Money;
  history: RewardWalletEntry[];
}

/**
 * A Spotlight Wealth campaign — a creator/event-led education or referral
 * programme. `iconColor` is a brand-palette token for the campaign glyph.
 */
export interface Campaign {
  id: string;
  title: string;
  description: string;
  iconColor: string;    // brand-palette token for the campaign icon tile
  cta: string;          // call-to-action label
}

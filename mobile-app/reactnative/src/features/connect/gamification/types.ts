// Paymax Connect — GAMIFICATION types (PRD §6.5, §10.10 GM-*).
//
// CRITICAL SAFETY INVARIANT (§6.5 "Two-currency clarity"):
//   XP and Coins are NON-CASH engagement currency. They are NOT Naira, are NOT
//   withdrawable, and NEVER silently convert to money. Any value here is points,
//   never kobo. The real-money wallet is kept strictly separate.

export interface GamificationProfile {
  level: number;
  xp: number;             // NON-CASH points (current level)
  xpToNextLevel: number;  // NON-CASH points needed to advance
  totalXp: number;        // lifetime NON-CASH points
  coins: number;          // NON-CASH coins — spendable ONLY on in-app rewards
  rank?: string;          // e.g. "Rising Star"
  streakDays: number;
}

export type MissionPeriod = 'daily' | 'weekly';
export type MissionStatus = 'in_progress' | 'completed' | 'claimed';

export interface Mission {
  id: string;
  title: string;
  description: string;
  period: MissionPeriod;
  progress: number;
  target: number;
  xpReward: number;       // NON-CASH
  coinReward: number;     // NON-CASH
  status: MissionStatus;
}

export interface StreakDay {
  day: number;            // 1..7
  rewardCoins: number;    // NON-CASH
  claimed: boolean;
  isToday: boolean;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  checkedInToday: boolean;
  days: StreakDay[];
  nextRewardCoins: number; // NON-CASH
}

export type LeaderboardScope = 'gifters' | 'streamers' | 'voters' | 'regional';

export interface GameLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatar: string;
  // For engagement boards this is XP/points (NON-CASH). It is NEVER money.
  points: number;
  level?: number;
  region?: string;
}

export interface Season {
  id: string;
  name: string;
  theme: string;
  bannerUrl: string;
  endsAtIso: string;
  passTier: number;          // current pass tier reached
  passTotalTiers: number;
  passXp: number;            // NON-CASH season points
  passXpToNext: number;      // NON-CASH
  isPassUnlocked: boolean;   // free vs unlocked track
  rewards: SeasonReward[];
}

export interface SeasonReward {
  tier: number;
  label: string;
  icon: string;              // lucide name
  track: 'free' | 'premium';
  unlocked: boolean;
  claimed: boolean;
  isCash: false;             // hard literal: season rewards are NEVER cash
}

export type RewardCategory = 'cosmetic' | 'boost' | 'badge' | 'entry';

export interface CatalogReward {
  id: string;
  name: string;
  description: string;
  icon: string;              // lucide name
  category: RewardCategory;
  costCoins: number;         // NON-CASH coin price
  owned: boolean;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;              // lucide name
  earned: boolean;
  earnedAtIso?: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface XpHistoryEntry {
  id: string;
  source: string;            // e.g. "Daily check-in", "Sent a gift"
  xp: number;                // NON-CASH (+/-)
  coins: number;             // NON-CASH (+/-)
  atIso: string;
}

export interface RedeemResult {
  ok: boolean;
  rewardId: string;
  newCoinBalance: number;    // NON-CASH balance after redemption
}

export interface ClaimResult {
  ok: boolean;
  xpAwarded: number;         // NON-CASH
  coinsAwarded: number;      // NON-CASH
}

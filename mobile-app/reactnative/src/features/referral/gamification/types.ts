// Self-contained types for missions/quests, streaks, ranks/badges, leaderboards,
// contests and the rank-up celebration. IMPORTANT: gamification POINTS are
// NON-CASH — they are a status/progress currency, never naira and never auto-
// converted to money. Where a mission also pays a cash reward, the cash amount
// is a separate integer-kobo field and is always tied to a friend's verified
// activity (§7). Points and cash are kept as distinct fields on purpose.

export type MissionStatus = 'available' | 'in_progress' | 'completed' | 'expired';

export interface MissionStep {
  id: string;
  label: string;
  /** The verified action this step requires (drives the "real activity" line). */
  hint?: string;
  done: boolean;
}

export interface MissionReward {
  /** NON-CASH gamification points. Never money. */
  points: number;
  /** Optional cash reward in integer kobo, paid only on friends' real activity. */
  cashKobo: number | null;
  /** Optional badge granted on completion. */
  badge?: string | null;
}

export interface MissionSummary {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  status: MissionStatus;
  /** 0..1 progress. */
  progress: number;
  stepsDone: number;
  stepsTotal: number;
  reward: MissionReward;
  /** ISO end date for time-bound quests; null = evergreen. */
  endsAt: string | null;
}

export interface MissionDetail extends MissionSummary {
  /** Compliant explanation: reward ties to a friend's real activity. */
  explanation: string;
  steps: MissionStep[];
}

export interface Milestone {
  id: string;
  label: string;
  atStreak: number;
  /** NON-CASH reward points for hitting the milestone. */
  points: number;
  reached: boolean;
}

export interface StreakState {
  /** Consecutive active days/weeks. */
  current: number;
  longest: number;
  unit: 'day' | 'week';
  /** ISO when the current streak will break if no qualifying activity. */
  expiresAt: string | null;
  milestones: Milestone[];
}

export interface RankTier {
  key: string;
  name: string;
  /** NON-CASH points threshold to reach this tier. */
  threshold: number;
  perks: string[];
  reached: boolean;
  current: boolean;
}

export interface Badge {
  id: string;
  name: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
  description: string;
}

export interface RanksBadgesState {
  /** Current NON-CASH points balance (status currency, not money). */
  pointsBalance: number;
  currentTier: string;
  nextTier: string | null;
  pointsToNext: number | null;
  tiers: RankTier[];
  badges: Badge[];
}

export type LeaderboardScope = 'friends' | 'estate' | 'campaign' | 'global';

export interface LeaderboardRow {
  rank: number;
  name: string;
  /** NON-CASH points score. */
  points: number;
  isYou: boolean;
  /** Movement vs last cycle. */
  delta: number;
}

export interface Leaderboard {
  scope: LeaderboardScope;
  resetAt: string | null;
  yourRank: number | null;
  rows: LeaderboardRow[];
}

export type ContestStatus = 'upcoming' | 'live' | 'ended';

export interface Contest {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  status: ContestStatus;
  startsAt: string;
  endsAt: string;
  /** Headline prize (display copy — may be cash, points, or items). */
  prizeLabel: string;
  /** Whether the prize pool is cash (kobo) — shown explicitly when so. */
  prizePoolKobo: number | null;
  joined: boolean;
  participants: number;
}

export interface RankUpEvent {
  /** New tier name reached. */
  newTier: string;
  /** NON-CASH points awarded for the rank-up. */
  bonusPoints: number;
  /** Optional new badge. */
  badge: string | null;
  unlockedPerks: string[];
  shareHook: string;
}

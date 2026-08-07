// ── Gamification live-response adapters (Go gamification API → mobile) ───────
// The Go engine awards XP + streak server-side on assessment/exam completion and
// stores a profile ({user_id, xp, level, streak_days, freezes}); the mobile UI
// codes against GamificationProfile ({level, xp, xpToNext, streakDays,
// freezeTokens, rank?}). This pure adapter bridges them, computing xpToNext from
// the backend's level curve.

import type { GamificationProfile, Challenge, Badge, ClassLeaderboard, LeaderboardEntry } from './types';

export interface GoGamificationProfile {
  user_id: string;
  xp: number;
  level: number;
  streak_days: number;
  freezes: number;
  last_active?: string | null;
}

// Level curve — MIRRORS academy/gamification DefaultConfig (LevelBaseXP=100,
// LevelStepXP=150). Cumulative XP threshold to advance FROM `level` to level+1,
// matching the backend's levelForXP loop: threshold(L) = L*100 + (L-1)*L/2*150.
// Kept in sync with the server defaults; if the server curve becomes configurable
// this should move to a server-provided xp_to_next field.
const LEVEL_BASE_XP = 100;
const LEVEL_STEP_XP = 150;

export function xpThresholdForNextLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return n * LEVEL_BASE_XP + ((n - 1) * n) / 2 * LEVEL_STEP_XP;
}

// ── Class leaderboard ────────────────────────────────────────────────────────

export interface GoClassLeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  is_me: boolean;
}

export interface GoClassLeaderboard {
  class_code?: string;
  period_key?: string;
  my_rank?: number;
  entries?: GoClassLeaderboardEntry[];
}

/** Adapt the Go class board → mobile ClassLeaderboard (snake→camel; entries are
 *  already child-safe first-name/rank/xp/isMe from the server). */
export function adaptClassLeaderboard(go: GoClassLeaderboard): ClassLeaderboard {
  const entries: LeaderboardEntry[] = (go.entries ?? []).map((e) => ({
    rank: e.rank,
    name: e.name,
    xp: e.xp,
    isMe: !!e.is_me,
  }));
  return {
    classCode: go.class_code ?? '',
    periodKey: go.period_key ?? 'all-time',
    myRank: go.my_rank ?? 0,
    entries,
  };
}

// ── Badges ───────────────────────────────────────────────────────────────────

export interface GoBadgeView {
  id: string;
  code: string;
  name: string;
  description?: string;
  icon?: string | null;
  earned?: boolean;
  earned_at?: string | null;
}

/** Adapt a Go badge-view (catalogue row + earned status) → mobile Badge. */
export function adaptBadge(go: GoBadgeView): Badge {
  return {
    id: go.id,
    name: go.name,
    description: go.description ?? '',
    icon: go.icon ?? 'award',
    earned: !!go.earned,
    earnedAt: go.earned_at ?? undefined,
  };
}

export function adaptBadges(rows: GoBadgeView[] | undefined): Badge[] {
  return (rows ?? []).map(adaptBadge);
}

// ── Challenges ───────────────────────────────────────────────────────────────

export interface GoChallenge {
  id: string;
  code: string;
  name: string;
  kind: string; // daily|weekly|sponsor (matches the mobile cadence)
  criteria?: Record<string, unknown> | null;
  sponsor_id?: string | null;
  reward_pool_id?: string | null;
  status?: string;
  progress?: number; // caller's progress (ChallengeView)
  completed?: boolean;
}

const CADENCES: Challenge['cadence'][] = ['daily', 'weekly', 'sponsor'];
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Adapt a Go challenge view → mobile Challenge. progress/completed come from the
 *  server (counted per the challenge metric in its window); target + rewardPoints
 *  + description are read from the criteria jsonb. */
export function adaptChallenge(go: GoChallenge): Challenge {
  const c = go.criteria ?? {};
  const cadence = CADENCES.includes(go.kind as Challenge['cadence']) ? (go.kind as Challenge['cadence']) : 'daily';
  const target = toNum(c.target) || 1;
  const progress = Math.max(0, Math.min(target, toNum(go.progress)));
  return {
    id: go.id,
    title: go.name,
    description: typeof c.description === 'string' ? c.description : '',
    cadence,
    progress,
    target,
    rewardPoints: toNum(c.reward_points),
    sponsor: go.sponsor_id ?? undefined,
    completed: go.completed ?? progress >= target,
  };
}

export function adaptChallenges(rows: GoChallenge[] | undefined): Challenge[] {
  return (rows ?? []).map(adaptChallenge);
}

/** Adapt the Go gamification profile → the mobile shape. xpToNext is how much
 *  more XP reaches the next level (0 at/after the threshold). rank is left unset
 *  until the leaderboard is wired. */
export function adaptGamificationProfile(go: GoGamificationProfile): GamificationProfile {
  const level = Math.max(1, go.level || 1);
  const xp = Math.max(0, go.xp || 0);
  return {
    level,
    xp,
    xpToNext: Math.max(0, xpThresholdForNextLevel(level) - xp),
    streakDays: Math.max(0, go.streak_days || 0),
    freezeTokens: Math.max(0, go.freezes || 0),
  };
}

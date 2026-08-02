// ── Gamification live-response adapters (Go gamification API → mobile) ───────
// The Go engine awards XP + streak server-side on assessment/exam completion and
// stores a profile ({user_id, xp, level, streak_days, freezes}); the mobile UI
// codes against GamificationProfile ({level, xp, xpToNext, streakDays,
// freezeTokens, rank?}). This pure adapter bridges them, computing xpToNext from
// the backend's level curve.

import type { GamificationProfile, Challenge, Badge } from './types';

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
}

const CADENCES: Challenge['cadence'][] = ['daily', 'weekly', 'sponsor'];
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Adapt a Go challenge row → mobile Challenge. Per-user progress isn't tracked
 *  server-side yet, so progress is 0 / completed false; target + rewardPoints +
 *  description are read from the criteria jsonb. */
export function adaptChallenge(go: GoChallenge): Challenge {
  const c = go.criteria ?? {};
  const cadence = CADENCES.includes(go.kind as Challenge['cadence']) ? (go.kind as Challenge['cadence']) : 'daily';
  return {
    id: go.id,
    title: go.name,
    description: typeof c.description === 'string' ? c.description : '',
    cadence,
    progress: 0,
    target: toNum(c.target) || 1,
    rewardPoints: toNum(c.reward_points),
    sponsor: go.sponsor_id ?? undefined,
    completed: false,
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

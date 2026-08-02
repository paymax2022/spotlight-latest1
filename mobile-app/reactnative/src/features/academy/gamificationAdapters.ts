// ── Gamification live-response adapters (Go gamification API → mobile) ───────
// The Go engine awards XP + streak server-side on assessment/exam completion and
// stores a profile ({user_id, xp, level, streak_days, freezes}); the mobile UI
// codes against GamificationProfile ({level, xp, xpToNext, streakDays,
// freezeTokens, rank?}). This pure adapter bridges them, computing xpToNext from
// the backend's level curve.

import type { GamificationProfile } from './types';

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

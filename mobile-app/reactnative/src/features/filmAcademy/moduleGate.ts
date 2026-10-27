// What the learner is told about the module-unlock gate, in one place.
// THE SERVER DECIDES. Whether a module is locked and whether a quiz was passed
// come from /api/academy/learning (`isLocked`, `lastResult.passed`) and from the
// attempt-start refusal (MODULE_LOCKED / MODULE_UNAVAILABLE). Nothing here
// re-derives pass/fail: a rounded percentage would turn 84.6% into "85%" and
// the app would disagree with the server. Pure, so it is unit-tested with
// node --test (tests/unit/filmAcademy).
import type { FilmAcademyModule } from './types';

/** The pass mark the module gate uses when the server did not send one. */
const DEFAULT_PASS_MARK = 85;

/**
 * Why module `index` is locked, naming the module whose quiz opens it.
 * "Pass Module 2's quiz with 85% to unlock."
 */
export function lockedModuleMessage(modules: FilmAcademyModule[], index: number): string {
  const prev = index > 0 ? modules[index - 1] : undefined;
  const passMark = prev?.quiz?.passMark ?? DEFAULT_PASS_MARK;
  if (!prev) return `Pass the previous module's quiz with ${passMark}% to unlock.`;
  return `Pass Module ${index}'s quiz with ${passMark}% to unlock.`;
}

/**
 * Whole-number percent for display, computed from points and rounded DOWN, so a
 * score just under the pass mark never reads as the pass mark (84.6% shows 84%,
 * not 85%). Display only — pass/fail always comes from the server's `passed`.
 */
export function displayPercent(earned: number, possible: number): number | null {
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || possible <= 0 || earned < 0) return null;
  return Math.floor((earned * 100) / possible);
}

/** "17 of 20 points · 85%", falling back to the server's percent if points are missing. */
export function scoreSummary(r: { earnedPoints?: number; maxPoints?: number; scorePercent?: number }): string {
  const pct = displayPercent(Number(r.earnedPoints), Number(r.maxPoints));
  if (pct === null) return typeof r.scorePercent === 'number' ? `${Math.floor(r.scorePercent)}%` : '';
  return `${r.earnedPoints} of ${r.maxPoints} points · ${pct}%`;
}

export type GateRefusal = 'module_locked' | 'module_unavailable';

type ErrorLike = {
  code?: unknown;
  response?: { status?: number; data?: { code?: unknown; error?: unknown; message?: unknown } };
};

/**
 * Is this API error the module gate refusing? Reads the `code` when the server
 * sends one, and otherwise recognises the gate's own 403 wording (the start
 * route currently returns only `{ error: message }`).
 */
export function gateRefusal(error: unknown): GateRefusal | null {
  const e = (error ?? {}) as ErrorLike;
  const data = e.response?.data;
  const code = typeof data?.code === 'string' ? data.code : typeof e.code === 'string' ? e.code : '';
  if (code === 'MODULE_LOCKED') return 'module_locked';
  if (code === 'MODULE_UNAVAILABLE') return 'module_unavailable';
  if (e.response?.status !== 403) return null;
  const text = [data?.error, data?.message].filter((v) => typeof v === 'string').join(' ');
  if (/MODULE_LOCKED|module quiz first to unlock|module is locked/i.test(text)) return 'module_locked';
  if (/MODULE_UNAVAILABLE|module is not open yet/i.test(text)) return 'module_unavailable';
  return null;
}

/** Copy for a gate refusal; `lockHint` is lockedModuleMessage() when the screen knows the module. */
export function gateRefusalMessage(kind: GateRefusal, lockHint?: string): string {
  if (kind === 'module_unavailable') {
    return 'This module is not open yet. It will appear once your tutors publish it.';
  }
  return `This module is still locked. ${lockHint ?? `Pass the previous module's quiz with ${DEFAULT_PASS_MARK}% to unlock.`}`;
}

// Deterministic, server-side marking for film exams.
//
// The learner's saved answer is a PRESENTATION option id (from the shuffled
// snapshot). The scorer maps it back to the bank option id via the snapshot's
// optionMap, then compares against the immutable answer key of the drawn question
// version. Display order can never change the mark (QA-02).

import type { ExamScore, FilmQuestionOption, PresentedOption, SnapshotItem } from './types';

export interface AnswerKeyEntry {
  questionItemId: string;
  correctOptionIds: string[];
}

/** A pure rng in [0,1) so shuffles are testable and never depend on Math.random. */
export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** Fisher-Yates, non-mutating. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Turn a bank question into a presentation + the mapping snapshot needs.
 * `presentationOptionId` is stable within the attempt (po_1..po_n) but NOT the
 * bank id, so the client cannot infer which letter was correct.
 */
export function presentQuestion(
  questionItemId: string,
  stem: string,
  points: number,
  options: FilmQuestionOption[],
  attemptQuestionId: string,
  rng: Rng,
): { presentedOptions: PresentedOption[]; snapshot: SnapshotItem } {
  const order = shuffle(options, rng);
  const presentedOptions = order.map((o, i) => ({
    presentationOptionId: `${attemptQuestionId}_po${i + 1}`,
    text: o.text,
  }));
  const optionMap: Record<string, string> = {};
  presentedOptions.forEach((p, i) => { optionMap[p.presentationOptionId] = order[i].id; });
  return {
    presentedOptions,
    snapshot: { attemptQuestionId, questionItemId, points, stem, options: presentedOptions, optionMap },
  };
}

/**
 * Score an attempt from its immutable snapshot + the learner's saved responses.
 * An unanswered item earns 0 but still counts toward maxPoints (§7.6 precision:
 * we sum points, we never average rounded percentages).
 */
export function scoreAttempt(
  snapshot: SnapshotItem[],
  responsesByAqId: Record<string, string | null | undefined>,
  keys: AnswerKeyEntry[],
  passMark: number,
): ExamScore {
  const keyByItem = new Map(keys.map((k) => [k.questionItemId, new Set(k.correctOptionIds)]));
  let earned = 0;
  let max = 0;
  let answered = 0;

  for (const item of snapshot) {
    max += item.points;
    const selected = responsesByAqId[item.attemptQuestionId];
    if (!selected) continue;
    answered += 1;
    const bankId = item.optionMap[selected];
    const correct = keyByItem.get(item.questionItemId);
    if (bankId && correct?.has(bankId)) earned += item.points;
  }

  // Zero eligible points is NOT_READY, never 0% pass and never a divide-by-zero.
  //
  // The gate is exact integer arithmetic, never a float percentage:
  //     earned * 100 >= max * passMark
  // A displayed 85.0 from rounding 16.99/20 must not open a gate that the raw
  // points did not earn (TMFA: 16/20 and 8/10 fail; 17/20 and 9/10 pass).
  const threshold = Number.isFinite(passMark) ? Math.round(passMark) : 100;
  const exactInputs = Number.isInteger(earned) && Number.isInteger(max) && max > 0;
  const passed = exactInputs && earned * 100 >= max * threshold;
  const percentage = max > 0 ? Math.round((earned * 10000) / max) / 100 : 0;

  return {
    earnedPoints: earned,
    maxPoints: max,
    percentage,
    passed,
    answeredCount: answered,
    totalCount: snapshot.length,
  };
}

export type ExamGateReason = 'pass' | 'below_pass_mark' | 'no_eligible_questions' | 'incomplete';

/** Human-safe pass/fail reason for a learner result (never exposes per-item keys). */
export function examGateReason(score: ExamScore, reason?: ExamGateReason): ExamGateReason {
  if (score.maxPoints === 0) return 'no_eligible_questions';
  if (reason === 'incomplete') return 'incomplete';
  return score.passed ? 'pass' : 'below_pass_mark';
}

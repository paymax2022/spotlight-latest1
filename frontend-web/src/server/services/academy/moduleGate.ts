// The module-unlock gate for the Film Academy curriculum.
//
// A module is open only when the previous module's checkpoint quiz has a graded
// attempt at or above its pass mark. This file is the single rule both the
// learner curriculum view (/api/academy/learning) and the attempt-start
// eligibility check use, so the UI can never offer a quiz the server refuses
// and a direct call to the start endpoint can never skip a locked module.
//
// The comparison is done on integer points, never on the stored percentage:
// academy_exam_attempts.percentage is NUMERIC(5,2), so 84.996% is stored as
// 85.00 and would unlock an 85% gate it did not reach.

import type { BestAttempt } from './bestAttempt';

/**
 * Exact pass check on points: earned / possible >= passMark / 100, compared as
 * earned * 100 >= possible * passMark so no rounding is involved. Invalid
 * inputs (no possible points, negative or over-full scores) never pass.
 */
export function meetsPassMark(earned: number, possible: number, passMark: number): boolean {
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || !Number.isFinite(passMark)) return false;
  if (possible <= 0 || earned < 0 || earned > possible) return false;
  return earned * 100 >= possible * passMark;
}

export interface GateExam {
  id: string;
  pass_mark: number;
}

/** Did this best attempt pass the exam's quiz? */
export function quizPassed(exam: GateExam, best: BestAttempt | null | undefined): boolean {
  if (!best) return false;
  return meetsPassMark(best.score, best.totalPoints, exam.pass_mark);
}

/**
 * Lock state for each module, in curriculum order. The first module is always
 * open; a module whose predecessor has no quiz is open; otherwise it opens only
 * once that quiz is passed.
 */
export function moduleLockStates(
  orderedModuleIds: string[],
  examsByModuleId: Map<string, GateExam>,
  bestByExamId: Map<string, BestAttempt>,
): boolean[] {
  return orderedModuleIds.map((_, idx) => {
    if (idx === 0) return false;
    const prevExam = examsByModuleId.get(orderedModuleIds[idx - 1]);
    if (!prevExam) return false;
    return !quizPassed(prevExam, bestByExamId.get(prevExam.id));
  });
}

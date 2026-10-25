// The module-unlock gate for the Film Academy curriculum.
//
// A module is open only when the previous module's checkpoint quiz has a graded
// attempt at or above its pass mark. This file is the single rule the learner
// curriculum view (/api/academy/learning), the attempt-start eligibility check
// and the lesson-progress write all use, so the UI can never offer a quiz the
// server refuses and a direct API call can never skip a locked module.
//
// The comparison is done on integer points, never on the stored percentage:
// academy_exam_attempts.percentage is NUMERIC(5,2), so 84.996% is stored as
// 85.00 and would unlock an 85% gate it did not reach.

import type { createAdminClient } from '@/lib/supabase/server';
import { bestAttemptsByExam, type AttemptRow, type BestAttempt } from './bestAttempt';

type Db = ReturnType<typeof createAdminClient>;

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

/** A gate read failed; callers must refuse (fail closed), never treat it as open. */
export class ModuleGateUnavailableError extends Error {
  constructor(what: string, cause: unknown) {
    super(`module gate: ${what} read failed`);
    console.error(`[academy/module-gate] ${what} read failed`, cause);
  }
}

/**
 * Lock state of one module for one enrolment, read from the database:
 * 'unavailable' when the module is not a published module of the programme,
 * 'locked' when the previous module has a quiz that is not yet passed (every
 * quiz on it must be passed), otherwise 'open'. Throws
 * ModuleGateUnavailableError on any read failure.
 */
export async function moduleLockedFor(
  db: Db,
  programId: string,
  moduleId: string,
  enrollmentId: string,
): Promise<'open' | 'locked' | 'unavailable'> {
  const { data: mods, error: modErr } = await db
    .from('academy_modules')
    .select('id')
    .eq('program_id', programId)
    .eq('is_published', true)
    .order('order_index', { ascending: true });
  if (modErr) throw new ModuleGateUnavailableError('modules', modErr);
  const ids = ((mods ?? []) as Array<{ id: string }>).map((m) => m.id);
  const idx = ids.indexOf(moduleId);
  if (idx < 0) return 'unavailable';
  if (idx === 0) return 'open';

  const { data: prevExams, error: examErr } = await db
    .from('academy_exams')
    .select('id, pass_mark')
    .eq('program_id', programId)
    .eq('module_id', ids[idx - 1]);
  if (examErr) throw new ModuleGateUnavailableError('previous quiz', examErr);
  const gates = (prevExams ?? []) as GateExam[];
  if (gates.length === 0) return 'open';

  const { data: attempts, error: attErr } = await db
    .from('academy_exam_attempts')
    .select('exam_id, status, score, total_points, percentage, passed')
    .eq('enrollment_id', enrollmentId)
    .in('exam_id', gates.map((g) => g.id));
  if (attErr) throw new ModuleGateUnavailableError('attempts', attErr);
  const best = bestAttemptsByExam((attempts ?? []) as AttemptRow[]);
  return gates.every((g) => quizPassed(g, best.get(g.id))) ? 'open' : 'locked';
}

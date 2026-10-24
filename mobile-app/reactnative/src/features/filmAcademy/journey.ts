// Pure logic behind the learner journey screens (My course, the lesson header, the
// Academy home "Continue learning" card). No React, no network: everything here is a
// function of the curriculum the server already sent, so it is unit-testable and the
// screens stay thin.
//
// The server decides what is locked (`isLocked`) and whether a quiz can start
// (`canStart`); nothing here re-derives those rules, it only reads them.

import type { FilmAcademyModule } from './types';

export type ModuleState = 'locked' | 'not_started' | 'in_progress' | 'quiz_ready' | 'passed' | 'complete';

export type QuizAction =
  | { kind: 'finish_lessons'; remaining: number }
  | { kind: 'start' }
  | { kind: 'retry'; scorePercent: number }
  | { kind: 'passed'; scorePercent: number }
  | { kind: 'unavailable' };

export type NextStep =
  | { type: 'lesson'; lessonId: string; title: string; moduleTitle: string; moduleIndex: number }
  | { type: 'quiz'; quizId: string; title: string; moduleTitle: string; moduleIndex: number }
  | { type: 'complete' };

// "All lessons done" is vacuously true for a module with no lessons: its quiz is then
// reachable at once (the server locks the NEXT module until it is passed), so treating it
// as not-done would strand the learner on a course that reads "complete".
const lessonsDone = (m: FilmAcademyModule): boolean => m.completedCount >= m.lessons.length;

export function moduleState(m: FilmAcademyModule): ModuleState {
  if (m.isLocked) return 'locked';
  if (m.quiz?.lastResult?.passed) return 'passed';
  if (m.lessons.length === 0 && !m.quiz) return 'not_started';
  if (lessonsDone(m)) return m.quiz ? 'quiz_ready' : 'complete';
  return m.completedCount > 0 ? 'in_progress' : 'not_started';
}

/** What the quiz block of a module should offer. `null` when the module has no quiz. */
export function quizAction(m: FilmAcademyModule): QuizAction | null {
  const quiz = m.quiz;
  if (!quiz) return null;
  // A pass stands even if a lesson is un-ticked afterwards.
  if (quiz.lastResult?.passed) return { kind: 'passed', scorePercent: quiz.lastResult.scorePercent };
  if (!lessonsDone(m)) return { kind: 'finish_lessons', remaining: m.lessons.length - m.completedCount };
  if (!quiz.canStart) return { kind: 'unavailable' };
  if (quiz.lastResult) return { kind: 'retry', scorePercent: quiz.lastResult.scorePercent };
  return { kind: 'start' };
}

/**
 * The single most useful thing for the learner to do now. Walks the modules in order:
 * the first incomplete lesson of an unlocked module, else that module's pending quiz,
 * else on to the next module. Never points into a locked module.
 */
export function nextStep(modules: FilmAcademyModule[]): NextStep | null {
  if (modules.length === 0) return null;
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    if (m.isLocked) break;
    const lesson = m.lessons.find((l) => !l.completed);
    if (lesson) {
      return { type: 'lesson', lessonId: lesson.id, title: lesson.title, moduleTitle: m.title, moduleIndex: i };
    }
    if (m.quiz && !m.quiz.lastResult?.passed && m.quiz.canStart && lessonsDone(m)) {
      return { type: 'quiz', quizId: m.quiz.id, title: m.quiz.title, moduleTitle: m.title, moduleIndex: i };
    }
  }
  return { type: 'complete' };
}

/** Where a lesson sits: its module and its 1-based position within that module. */
export function locateLesson(
  modules: FilmAcademyModule[],
  lessonId: string,
): { moduleTitle: string; moduleIndex: number; position: number; count: number } | null {
  for (let i = 0; i < modules.length; i++) {
    const idx = modules[i].lessons.findIndex((l) => l.id === lessonId);
    if (idx >= 0) {
      return { moduleTitle: modules[i].title, moduleIndex: i, position: idx + 1, count: modules[i].lessons.length };
    }
  }
  return null;
}

export function courseProgress(c: { totalLessons: number; completedLessons: number }): number {
  if (c.totalLessons <= 0) return 0;
  return Math.min(100, Math.round((c.completedLessons / c.totalLessons) * 100));
}

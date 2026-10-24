// Pure logic for the Film Academy learner journey: what to do next, what state a module
// is in, what its quiz block should offer, and where a lesson sits in the course.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStep, moduleState, quizAction, locateLesson, courseProgress,
} from '@/features/filmAcademy/journey';
import type { FilmAcademyModule, FilmAcademyLesson, FilmAcademyModuleQuiz } from '@/features/filmAcademy/types';

const lesson = (id: string, completed = false): FilmAcademyLesson => ({
  id, title: `Lesson ${id}`, description: null, content_markdown: null, video_url: null,
  resource_url: null, resource_label: null, estimated_minutes: 10, is_required: true,
  completed, completed_at: completed ? '2026-10-01T00:00:00Z' : null,
});

const quiz = (over: Partial<FilmAcademyModuleQuiz> = {}): FilmAcademyModuleQuiz => ({
  id: 'q1', title: 'Module quiz', passMark: 85, timeLimitMinutes: 20, maxAttempts: 3,
  canStart: true, lastResult: null, ...over,
});

const mod = (id: string, done: boolean[], extra: Partial<FilmAcademyModule> = {}): FilmAcademyModule => {
  const lessons = done.map((d, i) => lesson(`${id}-${i + 1}`, d));
  return {
    id, title: `Module ${id}`, description: null, lessons,
    completedCount: lessons.filter((l) => l.completed).length, ...extra,
  };
};

describe('moduleState', () => {
  it('is locked whenever the server says so, whatever else is true', () => {
    assert.equal(moduleState(mod('a', [true, true], { isLocked: true, quiz: quiz() })), 'locked');
  });
  it('is not_started with no lessons done', () => {
    assert.equal(moduleState(mod('a', [false, false])), 'not_started');
  });
  it('is in_progress with some lessons done', () => {
    assert.equal(moduleState(mod('a', [true, false])), 'in_progress');
  });
  it('is quiz_ready when all lessons are done and a quiz is not yet passed', () => {
    assert.equal(moduleState(mod('a', [true, true], { quiz: quiz() })), 'quiz_ready');
    assert.equal(
      moduleState(mod('a', [true, true], { quiz: quiz({ lastResult: { scorePercent: 70, passed: false, earnedPoints: 7, maxPoints: 10 } }) })),
      'quiz_ready',
    );
  });
  it('is passed once the quiz is passed', () => {
    assert.equal(
      moduleState(mod('a', [true, true], { quiz: quiz({ lastResult: { scorePercent: 92, passed: true, earnedPoints: 9, maxPoints: 10 } }) })),
      'passed',
    );
  });
  it('is complete when all lessons are done and there is no quiz', () => {
    assert.equal(moduleState(mod('a', [true, true])), 'complete');
  });
  it('treats a module with no lessons as not_started, not complete', () => {
    assert.equal(moduleState(mod('a', [])), 'not_started');
  });
});

describe('a module with a quiz but no lessons', () => {
  it('is quiz_ready, its quiz is startable, and the next step is the quiz (not "complete")', () => {
    const empty = mod('e', [], { quiz: quiz({ id: 'qe', title: 'Empty quiz' }) });
    assert.equal(moduleState(empty), 'quiz_ready');
    assert.deepEqual(quizAction(empty), { kind: 'start' });
    const s = nextStep([empty, mod('n', [false], { isLocked: true })]);
    assert.deepEqual(s, { type: 'quiz', quizId: 'qe', title: 'Empty quiz', moduleTitle: 'Module e', moduleIndex: 0 });
  });
  it('an empty module without a quiz is skipped by nextStep, not treated as the end', () => {
    const s = nextStep([mod('e', []), mod('n', [false])]);
    assert.equal(s?.type === 'lesson' ? s.lessonId : '', 'n-1');
  });
});

describe('quizAction', () => {
  it('is null when the module has no quiz', () => {
    assert.equal(quizAction(mod('a', [true])), null);
  });
  it('asks to finish lessons first and says how many remain', () => {
    assert.deepEqual(quizAction(mod('a', [true, false, false], { quiz: quiz() })), { kind: 'finish_lessons', remaining: 2 });
  });
  it('offers start when lessons are done and nothing was attempted', () => {
    assert.deepEqual(quizAction(mod('a', [true], { quiz: quiz() })), { kind: 'start' });
  });
  it('offers retry with the last score after a failed attempt', () => {
    const q = quiz({ lastResult: { scorePercent: 70, passed: false, earnedPoints: 7, maxPoints: 10 } });
    assert.deepEqual(quizAction(mod('a', [true], { quiz: q })), { kind: 'retry', scorePercent: 70 });
  });
  it('reports passed with the score, even if lessons were later un-ticked', () => {
    const q = quiz({ lastResult: { scorePercent: 92, passed: true, earnedPoints: 9, maxPoints: 10 } });
    assert.deepEqual(quizAction(mod('a', [true, false], { quiz: q })), { kind: 'passed', scorePercent: 92 });
  });
  it('is unavailable when the server will not let the learner start', () => {
    assert.deepEqual(quizAction(mod('a', [true], { quiz: quiz({ canStart: false }) })), { kind: 'unavailable' });
  });
});

describe('nextStep', () => {
  it('returns the first incomplete lesson of the first module', () => {
    const s = nextStep([mod('a', [true, false, false]), mod('b', [false])]);
    assert.deepEqual(s, { type: 'lesson', lessonId: 'a-2', title: 'Lesson a-2', moduleTitle: 'Module a', moduleIndex: 0 });
  });
  it('moves to the quiz once the module lessons are done and the quiz is not passed', () => {
    const s = nextStep([mod('a', [true, true], { quiz: quiz({ id: 'qa', title: 'A quiz' }) }), mod('b', [false], { isLocked: true })]);
    assert.deepEqual(s, { type: 'quiz', quizId: 'qa', title: 'A quiz', moduleTitle: 'Module a', moduleIndex: 0 });
  });
  it('skips a passed module and continues into the next unlocked one', () => {
    const passed = quiz({ lastResult: { scorePercent: 90, passed: true, earnedPoints: 9, maxPoints: 10 } });
    const s = nextStep([mod('a', [true], { quiz: passed }), mod('b', [false, false])]);
    assert.equal(s?.type, 'lesson');
    assert.equal(s && s.type === 'lesson' ? s.lessonId : '', 'b-1');
  });
  it('never points into a locked module', () => {
    const s = nextStep([mod('a', [true, true]), mod('b', [false], { isLocked: true })]);
    assert.deepEqual(s, { type: 'complete' });
  });
  it('is complete when every lesson is done and every quiz passed', () => {
    const passed = quiz({ lastResult: { scorePercent: 90, passed: true, earnedPoints: 9, maxPoints: 10 } });
    assert.deepEqual(nextStep([mod('a', [true], { quiz: passed })]), { type: 'complete' });
  });
  it('is null for an empty curriculum', () => {
    assert.equal(nextStep([]), null);
  });
});

describe('locateLesson', () => {
  const mods = [mod('a', [true, false]), mod('b', [false, false, false])];
  it('gives module title, module index and 1-based position within the module', () => {
    assert.deepEqual(locateLesson(mods, 'b-2'), { moduleTitle: 'Module b', moduleIndex: 1, position: 2, count: 3 });
  });
  it('is null for an unknown lesson', () => {
    assert.equal(locateLesson(mods, 'zzz'), null);
  });
});

describe('courseProgress', () => {
  it('rounds the percentage and tolerates zero lessons', () => {
    assert.equal(courseProgress({ totalLessons: 3, completedLessons: 1 }), 33);
    assert.equal(courseProgress({ totalLessons: 0, completedLessons: 0 }), 0);
  });
  it('never exceeds 100', () => {
    assert.equal(courseProgress({ totalLessons: 2, completedLessons: 5 }), 100);
  });
});

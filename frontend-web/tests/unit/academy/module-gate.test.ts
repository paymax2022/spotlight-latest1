import { describe, it, expect } from 'vitest';
import { meetsPassMark, moduleLockStates, quizPassed } from '@/src/server/services/academy/moduleGate';
import { bestAttemptsByExam, type AttemptRow } from '@/src/server/services/academy/bestAttempt';
import { scoreAttempt } from '@/src/server/services/academy/assessment/scoring';
import { examEligibility, type ExamRow } from '@/src/server/services/academy/assessment/attempts';
import type { SnapshotItem } from '@/src/server/services/academy/assessment/types';

describe('meetsPassMark — exact 85% boundary', () => {
  it.each([
    [9, 10, true],   // GATE-002
    [8, 10, false],  // GATE-001
    [17, 20, true],  // GATE-003: exactly 85%
    [16, 20, false], // GATE-004
    [85, 100, true],
    [84, 100, false],
  ])('%i/%i at 85 → %s', (earned, possible, expected) => {
    expect(meetsPassMark(earned, possible, 85)).toBe(expected);
  });

  it('fails 84.999…% even though the stored NUMERIC(5,2) percentage would read 85.00', () => {
    // 5666/6666 = 84.9984…% → rounds to 85.00 at two decimals.
    expect(Math.round((100 * 5666) / 6666 * 100) / 100).toBe(85);
    expect(meetsPassMark(5666, 6666, 85)).toBe(false);
  });

  it('rejects invalid scores rather than passing them', () => {
    expect(meetsPassMark(0, 0, 85)).toBe(false);
    expect(meetsPassMark(-1, 10, 0)).toBe(false);
    expect(meetsPassMark(11, 10, 85)).toBe(false);
    expect(meetsPassMark(Number.NaN, 10, 85)).toBe(false);
  });
});

describe('scoreAttempt uses the exact pass check', () => {
  it('a just-under-85 attempt is not passed', () => {
    const snapshot: SnapshotItem[] = [
      { attemptQuestionId: 'a', questionItemId: 'q1', points: 5666, stem: 's', options: [], optionMap: { a_po1: 'a' } },
      { attemptQuestionId: 'b', questionItemId: 'q2', points: 1000, stem: 's', options: [], optionMap: { b_po1: 'a' } },
    ];
    const score = scoreAttempt(
      snapshot,
      { a: 'a_po1', b: null },
      [{ questionItemId: 'q1', correctOptionIds: ['a'] }, { questionItemId: 'q2', correctOptionIds: ['a'] }],
      85,
    );
    expect(score.percentage).toBe(85);
    expect(score.passed).toBe(false);
  });
});

const graded = (over: Partial<AttemptRow>): AttemptRow => ({
  exam_id: 'q1', status: 'graded', score: 0, total_points: 10, percentage: 0, passed: false, ...over,
});

describe('moduleLockStates', () => {
  const exams = new Map([
    ['m1', { id: 'q1', pass_mark: 85 }],
    ['m2', { id: 'q2', pass_mark: 85 }],
  ]);

  it('locks the next module after 8/10 and unlocks it after 9/10', () => {
    const failed = bestAttemptsByExam([graded({ score: 8, percentage: 80 })]);
    expect(moduleLockStates(['m1', 'm2', 'm3'], exams, failed)).toEqual([false, true, true]);

    const passed = bestAttemptsByExam([graded({ score: 9, percentage: 90 })]);
    expect(moduleLockStates(['m1', 'm2', 'm3'], exams, passed)).toEqual([false, false, true]);
  });

  it('does not unlock on a rounded-up stored percentage', () => {
    const best = bestAttemptsByExam([graded({ score: 5666, total_points: 6666, percentage: 85 })]);
    expect(quizPassed({ id: 'q1', pass_mark: 85 }, best.get('q1'))).toBe(false);
    expect(moduleLockStates(['m1', 'm2'], exams, best)).toEqual([false, true]);
  });

  it('leaves a module open when its predecessor has no quiz', () => {
    expect(moduleLockStates(['m0', 'm1'], exams, new Map())).toEqual([false, false]);
  });
});

// A minimal chainable stand-in for the Supabase client: enough for examEligibility.
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let countOnly = false;
      const builder = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          countOnly = !!opts?.head;
          return builder;
        },
        eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder; },
        in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
        order(col: string) {
          rows.sort((a, b) => Number(a[col] ?? 0) - Number(b[col] ?? 0));
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          resolve(countOnly ? { count: rows.length, error: null } : { data: rows, error: null });
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof examEligibility>[0];
}

describe('examEligibility enforces the module gate at start', () => {
  const exam = (over: Partial<ExamRow>): ExamRow => ({
    id: 'q2', program_id: 'p', module_id: 'm2', title: 'Quiz 2', description: null, kind: 'checkpoint',
    pass_mark: 85, time_limit_minutes: 15, max_attempts: 3, is_published: true,
    opens_at: null, closes_at: null, draw_stage: 'L0', draw_module_codes: [], draw_count: 4, ...over,
  });
  const learner = { enrollmentId: 'e1', programId: 'p', batchId: null };
  const modules = [
    { id: 'm1', program_id: 'p', is_published: true, order_index: 0 },
    { id: 'm2', program_id: 'p', is_published: true, order_index: 1 },
  ];
  const exams = [{ id: 'q1', program_id: 'p', module_id: 'm1', pass_mark: 85 }];
  const attempt = (score: number, percentage: number) => ({
    exam_id: 'q1', enrollment_id: 'e1', status: 'graded', score, total_points: 10, percentage, passed: false,
  });

  it('refuses module 2 quiz when module 1 quiz scored 8/10', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [attempt(8, 80)] });
    const gate = await examEligibility(db, exam({}), learner);
    expect(gate).toMatchObject({ ok: false, code: 'MODULE_LOCKED' });
  });

  it('refuses module 2 quiz when module 1 quiz was never taken', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [] });
    expect(await examEligibility(db, exam({}), learner)).toMatchObject({ ok: false, code: 'MODULE_LOCKED' });
  });

  it('allows module 2 quiz once module 1 quiz scored 9/10', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [attempt(9, 90)] });
    expect(await examEligibility(db, exam({}), learner)).toEqual({ ok: true });
  });

  it('allows the first module quiz with no prior work', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [] });
    expect(await examEligibility(db, exam({ id: 'q1', module_id: 'm1' }), learner)).toEqual({ ok: true });
  });

  it('refuses a quiz on an unpublished module', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [] });
    expect(await examEligibility(db, exam({ module_id: 'm9' }), learner)).toMatchObject({ ok: false, code: 'MODULE_UNAVAILABLE' });
  });

  it('does not apply the module gate to a stage exam with no module', async () => {
    const db = fakeDb({ academy_modules: modules, academy_exams: exams, academy_exam_attempts: [] });
    expect(await examEligibility(db, exam({ module_id: null, kind: 'stage_exam' }), learner)).toEqual({ ok: true });
  });
});

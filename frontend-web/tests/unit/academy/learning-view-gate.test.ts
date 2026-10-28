// The learner curriculum view must report the SAME module lock the server enforces
// on quiz start (attempts.ts) and on lesson progress (progress-gate.test.ts).
// Before this file the view compared the stored NUMERIC(5,2) percentage against the
// pass mark, so a 5666/6666 attempt that Postgres rounds to 85.00 was shown as open
// while the API refused it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type Row } from './fakeDb';

const state: { db: ReturnType<typeof fakeDb> | null } = { db: null };

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => state.db }));
vi.mock('@/src/server/services/academy', () => ({
  resolveLearner: async () => ({ ok: true, enrollmentId: 'e1', programId: 'p', batchId: null }),
  getDefaultProgramId: async () => null,
}));

const { GET } = await import('@/app/api/academy/learning/route');

interface ModuleView {
  id: string;
  isLocked: boolean;
  quiz?: { canStart: boolean; lastResult: { passed: boolean } | null };
}

const mod = (id: string, order: number): Row => ({
  id,
  program_id: 'p',
  is_published: true,
  order_index: order,
  title: `Module ${id}`,
  description: '',
  academy_lessons: [{ id: `${id}-lesson`, title: 'Lesson', is_published: true, order_index: 0 }],
});

const exams = [
  { id: 'q1', program_id: 'p', module_id: 'm1', title: 'Quiz 1', pass_mark: 85, time_limit_minutes: 15, max_attempts: 3 },
  { id: 'q2', program_id: 'p', module_id: 'm2', title: 'Quiz 2', pass_mark: 85, time_limit_minutes: 15, max_attempts: 3 },
];

const attempt = (score: number, total: number, percentage: number): Row => ({
  exam_id: 'q1', enrollment_id: 'e1', status: 'graded', score, total_points: total, percentage, passed: false,
});

async function view(attempts: Row[]): Promise<ModuleView[]> {
  state.db = fakeDb({
    academy_modules: [mod('m1', 0), mod('m2', 1)],
    academy_exams: exams,
    academy_exam_attempts: attempts,
    academy_lesson_progress: [],
  });
  const res = await GET(new Request('http://x/api/academy/learning'));
  expect(res.status).toBe(200);
  return (await res.json()).modules as ModuleView[];
}

describe('the curriculum view reports the lock the server enforces', () => {
  beforeEach(() => { state.db = null; });

  it('locks the next module after 8/10 and opens it after 9/10', async () => {
    const locked = await view([attempt(8, 10, 80)]);
    expect(locked.map((m) => [m.id, m.isLocked, m.quiz?.canStart])).toEqual([
      ['m1', false, true],
      ['m2', true, false],
    ]);

    const open = await view([attempt(9, 10, 90)]);
    expect(open.map((m) => [m.id, m.isLocked, m.quiz?.canStart])).toEqual([
      ['m1', false, true],
      ['m2', false, true],
    ]);
  });

  it('does not open a module on a percentage Postgres rounded up to the pass mark', async () => {
    const body = await view([attempt(5666, 6666, 85)]);
    expect(body[1].isLocked).toBe(true);
    expect(body[0].quiz?.lastResult?.passed).toBe(false);
  });

  it('ignores another enrolment’s pass', async () => {
    state.db = fakeDb({
      academy_modules: [mod('m1', 0), mod('m2', 1)],
      academy_exams: exams,
      academy_lesson_progress: [],
      academy_exam_attempts: [{ ...attempt(10, 10, 100), enrollment_id: 'e2' }],
    });
    const res = await GET(new Request('http://x/api/academy/learning'));
    const body = (await res.json()) as { modules: ModuleView[] };
    expect(body.modules[1].isLocked).toBe(true);
  });
});

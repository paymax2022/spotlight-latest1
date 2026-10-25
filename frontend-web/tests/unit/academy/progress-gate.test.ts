import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type Row } from './fakeDb';

const state: { db: ReturnType<typeof fakeDb> | null } = { db: null };

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => state.db }));
vi.mock('@/src/server/services/academy', () => ({
  resolveLearner: async () => ({ ok: true, enrollmentId: 'e1', programId: 'p', batchId: null }),
}));

const { POST } = await import('@/app/api/academy/learning/progress/route');

const modules = [
  { id: 'm1', program_id: 'p', is_published: true, order_index: 0 },
  { id: 'm2', program_id: 'p', is_published: true, order_index: 1 },
];
const lessons = [
  { id: 'l1', module_id: 'm1', academy_modules: { program_id: 'p' } },
  { id: 'l2', module_id: 'm2', academy_modules: { program_id: 'p' } },
];
const exams = [{ id: 'q1', program_id: 'p', module_id: 'm1', pass_mark: 85 }];
const attempt = (score: number): Row => ({
  exam_id: 'q1', enrollment_id: 'e1', status: 'graded', score, total_points: 10, percentage: score * 10, passed: false,
});

function setDb(attempts: Row[], failing: string[] = []) {
  state.db = fakeDb(
    { academy_modules: modules, academy_lessons: lessons, academy_exams: exams, academy_exam_attempts: attempts },
    failing,
  );
}

const post = (lessonId: string) =>
  POST(new Request('http://x/api/academy/learning/progress', { method: 'POST', body: JSON.stringify({ lessonId }) }));

describe('lesson progress respects the module gate', () => {
  beforeEach(() => setDb([]));

  it('refuses a lesson in a locked module with 403 MODULE_LOCKED and writes nothing', async () => {
    setDb([attempt(8)]);
    const res = await post('l2');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'MODULE_LOCKED' });
    expect(state.db!.updates).toEqual([]);
  });

  it('records a lesson once the previous quiz is passed at 9/10', async () => {
    setDb([attempt(9)]);
    const res = await post('l2');
    expect(res.status).toBe(200);
    expect(state.db!.updates).toMatchObject([{ table: 'academy_lesson_progress', patch: { lesson_id: 'l2', completed: true } }]);
  });

  it('always allows the first module', async () => {
    expect((await post('l1')).status).toBe(200);
  });

  it('fails closed when the gate cannot be read', async () => {
    setDb([attempt(10)], ['academy_exam_attempts']);
    const res = await post('l2');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'MODULE_GATE_UNAVAILABLE' });
    expect(state.db!.updates).toEqual([]);
  });
});

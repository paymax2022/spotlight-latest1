import { describe, expect, it } from 'vitest';
import { fakeDb, type Row } from './fakeDb';
import { publishExam } from '@/src/server/services/academy/assessment/exams';

const exam = (over: Row = {}): Row => ({
  id: 'x1', program_id: 'p', module_id: 'm7', title: 'Topic quiz', description: '', kind: 'checkpoint',
  pass_mark: 85, time_limit_minutes: 15, max_attempts: 3, is_published: false,
  opens_at: '2026-01-01T00:00:00Z', closes_at: '2027-01-01T00:00:00Z',
  draw_stage: 'L1', draw_module_codes: ['A01'], draw_count: 10, ...over,
});

let seq = 0;
const items = (code: string, n: number, over: Row = {}): Row[] =>
  Array.from({ length: n }, () => ({
    id: `i${seq++}`, academy_scope: 'film', status: 'approved', film_stage: 'L1', film_module_code: code, ...over,
  }));

function publish(examRow: Row, bank: Row[], attempts: Row[] = []) {
  const db = fakeDb({ academy_exams: [examRow], academy_question_items: bank, academy_exam_attempts: attempts });
  return publishExam(db, 'x1').then((r) => ({ r, published: db.updates.some((u) => u.patch.is_published === true) }));
}

describe('publish preflight — per-topic approved floor for checkpoints', () => {
  it('refuses at 19 approved items for a topic and publishes at 20', async () => {
    const short = await publish(exam(), items('A01', 19));
    expect(short.published).toBe(false);
    expect(short.r).toMatchObject({ published: false, required: 20, shortTopics: [{ code: 'A01', approved: 19 }] });
    expect(short.r.reason).toContain('A01 (19)');

    const ok = await publish(exam(), items('A01', 20));
    expect(ok.r.published).toBe(true);
    expect(ok.published).toBe(true);
  });

  it('names only the short topic among several, even when the total pool is ample', async () => {
    const bank = [...items('A01', 25), ...items('A02', 12), ...items('A03', 20)];
    const { r, published } = await publish(exam({ draw_module_codes: ['A01', 'A02', 'A03'] }), bank);
    expect(published).toBe(false);
    expect(r.shortTopics).toEqual([{ code: 'A02', approved: 12 }]);
    expect(r.reason).toContain('A02 (12)');
    expect(r.reason).not.toContain('A01');
  });

  it('does not count DRAFT items, other stages or other scopes', async () => {
    const bank = [
      ...items('A01', 19),
      ...items('A01', 5, { status: 'draft' }),
      ...items('A01', 5, { film_stage: 'L2' }),
      ...items('A01', 5, { academy_scope: 'general' }),
    ];
    const { r } = await publish(exam(), bank);
    expect(r).toMatchObject({ published: false, shortTopics: [{ code: 'A01', approved: 19 }] });
  });

  it('raises the floor to 2 x draw_count for a larger form', async () => {
    const { r } = await publish(exam({ draw_count: 15 }), items('A01', 29));
    expect(r).toMatchObject({ published: false, required: 30, shortTopics: [{ code: 'A01', approved: 29 }] });
    expect((await publish(exam({ draw_count: 15 }), items('A01', 30))).r.published).toBe(true);
  });

  it('applies to a new FM-coded checkpoint nobody has sat', async () => {
    const { r } = await publish(exam({ draw_stage: 'L0', draw_module_codes: ['FM07'], draw_count: 4 }),
      items('FM07', 4, { film_stage: 'L0' }));
    expect(r).toMatchObject({ published: false, shortTopics: [{ code: 'FM07', approved: 4 }] });
  });

  it('lets a seeded FM quiz learners have already sat be re-published on its old pool', async () => {
    const legacy = exam({ draw_stage: 'L0', draw_module_codes: ['FM01'], draw_count: 4 });
    const { r } = await publish(legacy, items('FM01', 4, { film_stage: 'L0' }), [{ id: 'a1', exam_id: 'x1' }]);
    expect(r.published).toBe(true);
  });

  it('does not apply to a stage exam or a checkpoint with no topic codes', async () => {
    expect((await publish(exam({ kind: 'stage_exam' }), items('A01', 10))).r.published).toBe(true);
    expect((await publish(exam({ draw_module_codes: [] }), items('A01', 10))).r.published).toBe(true);
  });
});

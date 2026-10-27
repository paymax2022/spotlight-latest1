/**
 * TMFA 85% mastery spec, §6 release gates — tests for behaviour that already
 * exists but had no test of its own. The boundary maths (GATE-001..004) lives in
 * module-gate.test.ts; this file pins the surrounding guarantees:
 *   GATE-002  an unlock is not undone by a later, lower retake
 *   GATE-005  client-supplied grading claims never reach the scorer
 *   GATE-011  lesson completion (a client flag) never unlocks a module
 *   GATE-012  a grade change without the review permission is refused, unwritten
 * See docs/academy/tmfa-gate-conformance.md for the full matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } }),
  },
}));
vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/lib/feature-flags', () => ({ featureFlags: { filmAcademyAssessment: () => true } }));
vi.mock('@/src/server/services/academy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/server/services/academy')>()),
  resolveLearner: vi.fn(),
}));
vi.mock('@/src/server/services/academy/assessment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/server/services/academy/assessment')>()),
  saveResponse: vi.fn(),
  submitAttempt: vi.fn(),
}));

import { POST as ANSWER } from '../../../app/api/academy/attempts/[attemptId]/answer/route';
import { POST as SUBMIT } from '../../../app/api/academy/attempts/[attemptId]/submit/route';
import { PATCH as GRADE } from '../../../app/api/admin/academy/submissions/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { resolveLearner } from '@/src/server/services/academy';
import { saveResponse, submitAttempt } from '@/src/server/services/academy/assessment';
import { ApiError } from '@/src/lib/api/responses';
import { moduleLockStates } from '@/src/server/services/academy/moduleGate';
import { bestAttemptsByExam, type AttemptRow } from '@/src/server/services/academy/bestAttempt';

const LEARNER = { ok: true as const, enrollmentId: 'enr-1', programId: 'prog-1', batchId: 'batch-1' };
const params = (attemptId: string) => ({ params: Promise.resolve({ attemptId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1', email: 's@example.com' } as never);
  vi.mocked(resolveLearner).mockResolvedValue(LEARNER as never);
  vi.mocked(createAdminClient).mockReturnValue({} as never);
});

const graded = (over: Partial<AttemptRow>): AttemptRow => ({
  exam_id: 'q1', status: 'graded', score: 0, total_points: 10, percentage: 0, passed: false, ...over,
});
const EXAMS = new Map([['m1', { id: 'q1', pass_mark: 85 }], ['m2', { id: 'q2', pass_mark: 85 }]]);

describe('GATE-002 — an unlock stands once earned', () => {
  it('a lower retake after a 9/10 pass does not re-lock the next module', () => {
    const best = bestAttemptsByExam([
      graded({ score: 9, percentage: 90, passed: true }),
      graded({ score: 5, percentage: 50 }),
    ]);
    expect(moduleLockStates(['m1', 'm2', 'm3'], EXAMS, best)).toEqual([false, false, true]);
  });
});

describe('GATE-011 — no mastery from a client flag', () => {
  it('only a graded quiz attempt opens a module; nothing else is an input', () => {
    // moduleLockStates reads module order, quizzes and graded attempts — lesson
    // progress (the client-set "completed" flag) is not an argument at all.
    expect(moduleLockStates(['m1', 'm2'], EXAMS, new Map())).toEqual([false, true]);
  });

  it('an in-progress attempt, or one the client calls passed, does not unlock', () => {
    const best = bestAttemptsByExam([
      graded({ status: 'submitted', score: 10, percentage: 100, passed: true }),
      graded({ score: 8, percentage: 85, passed: true }), // stored flag/percent lie; points say 8/10
    ]);
    expect(moduleLockStates(['m1', 'm2'], EXAMS, best)).toEqual([false, true]);
  });
});

describe('GATE-005 — client grading claims are ignored', () => {
  it('saving an answer forwards only the question and presentation ids', async () => {
    vi.mocked(saveResponse).mockResolvedValue({ attemptQuestionId: 'aq1', saved: true } as never);
    const res = await ANSWER(makeRequest('/api/academy/attempts/att-1/answer', {
      body: {
        attemptQuestionId: 'aq1', presentationOptionId: 'aq1_po2',
        correct_option: 'A', passed: true, score: 10, isCorrect: true,
      },
      headers: withAuth(),
    }), params('att-1'));
    expect(res.status).toBe(200);
    expect(saveResponse).toHaveBeenCalledTimes(1);
    const args = vi.mocked(saveResponse).mock.calls[0];
    expect(args.slice(1)).toEqual([
      'att-1',
      { enrollmentId: 'enr-1', programId: 'prog-1', batchId: 'batch-1' },
      'aq1',
      'aq1_po2',
    ]);
  });

  it('submitting ignores any score or verdict in the body — the server scores', async () => {
    vi.mocked(submitAttempt).mockResolvedValue({ attemptId: 'att-1', passed: false } as never);
    const res = await SUBMIT(makeRequest('/api/academy/attempts/att-1/submit', {
      body: { passed: true, score: 10, scorePercent: 100, answers: { aq1: 'A' } },
      headers: withAuth(),
    }), params('att-1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(submitAttempt).mock.calls[0].slice(1)).toEqual([
      'att-1',
      { enrollmentId: 'enr-1', programId: 'prog-1', batchId: 'batch-1' },
    ]);
    expect((await res.json()).result.passed).toBe(false);
  });
});

describe('GATE-012 — grade changes need the review permission', () => {
  it('refuses with 403 and writes nothing when the permission check fails', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValue(new ApiError('Forbidden', 403));
    const from = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);
    const res = await GRADE(makeRequest('/api/admin/academy/submissions', {
      method: 'PATCH',
      body: { submissionId: 'sub-1', score: 50 },
      headers: withAuth(),
    }));
    expect(res.status).toBe(403);
    expect(assertAdminPermission).toHaveBeenCalledWith(expect.anything(), 'applications:review');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('gate refusals carry a machine-readable code', () => {
  it('returns the ExamError code alongside the message', async () => {
    const { ExamError } = await import('@/src/server/services/academy/assessment');
    vi.mocked(saveResponse).mockRejectedValue(
      new ExamError(403, 'MODULE_LOCKED', 'Pass the previous module quiz first to unlock this one.'),
    );
    const res = await ANSWER(makeRequest('/api/academy/attempts/att-1/answer', {
      body: { attemptQuestionId: 'aq1', presentationOptionId: 'aq1_po1' },
      headers: withAuth(),
    }), params('att-1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'MODULE_LOCKED' });
  });
});

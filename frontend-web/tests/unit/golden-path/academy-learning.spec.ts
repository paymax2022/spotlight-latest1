/**
 * Golden-path suite: Film Academy learning + assignments.
 *
 * The invariants that matter here are ownership ones. Lesson progress and
 * assignment submissions are keyed on enrollment_id, and the enrolment is always
 * resolved from the SESSION — never taken from the request — so a learner cannot
 * address another learner's rows by guessing an id. These tests pin that, plus
 * the grading bounds and the resubmission rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, withAuth } from './_fixtures';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({ requireRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/src/server/services/academy/learner', () => ({ resolveLearner: vi.fn() }));

import { POST as PROGRESS } from '../../../app/api/academy/learning/progress/route';
import { POST as SUBMIT } from '../../../app/api/academy/assignments/submit/route';
import { PATCH as GRADE } from '../../../app/api/admin/academy/submissions/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { resolveLearner } from '@/src/server/services/academy/learner';

const USER = { id: 'user-001', email: 'student@example.com' };
const LEARNER = { ok: true as const, enrollmentId: 'enr-1', programId: 'prog-1', batchId: 'batch-1' };

type Rows = Record<string, unknown>;

/** Records every upsert/update so a test can assert what was written. */
function db(rows: Record<string, Rows | null>) {
  const writes: Array<{ table: string; op: string; payload: Rows }> = [];
  const api = {
    writes,
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        upsert: async (payload: Rows) => {
          writes.push({ table, op: 'upsert', payload });
          return { error: null };
        },
        update: (payload: Rows) => {
          writes.push({ table, op: 'update', payload });
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  };
  return api as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue(USER as any);
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'admin', actorId: 'admin-1' } as any);
  vi.mocked(resolveLearner).mockResolvedValue(LEARNER as any);
});

describe('POST /api/academy/learning/progress', () => {
  const body = { lessonId: 'lesson-1', completed: true };

  it('refuses a lesson from another programme', async () => {
    // The id is real; it just is not this learner's. Without the ownership check a
    // learner could mark progress against any lesson in the database.
    const d = db({ academy_lessons: { id: 'lesson-1', academy_modules: { program_id: 'prog-OTHER' } } });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await PROGRESS(makeRequest('/api/academy/learning/progress', { body, headers: withAuth() }));
    expect(res.status).toBe(404);
    expect(d.writes).toHaveLength(0);
  });

  it('records progress against the session enrolment, never a client-supplied one', async () => {
    const d = db({ academy_lessons: { id: 'lesson-1', academy_modules: { program_id: 'prog-1' } } });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await PROGRESS(
      makeRequest('/api/academy/learning/progress', {
        body: { ...body, enrollmentId: 'enr-SOMEONE-ELSE' },
        headers: withAuth(),
      }),
    );

    expect(res.status).toBe(200);
    expect(d.writes[0].payload.enrollment_id).toBe('enr-1');
  });

  it('rejects a request with no lesson', async () => {
    vi.mocked(createAdminClient).mockReturnValue(db({}));
    const res = await PROGRESS(makeRequest('/api/academy/learning/progress', { body: {}, headers: withAuth() }));
    expect(res.status).toBe(400);
  });

  it('refuses progress from someone not yet enrolled', async () => {
    vi.mocked(resolveLearner).mockResolvedValue({ ok: false, reason: 'tuition_unpaid' } as any);
    vi.mocked(createAdminClient).mockReturnValue(db({}));
    const res = await PROGRESS(makeRequest('/api/academy/learning/progress', { body, headers: withAuth() }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/academy/assignments/submit', () => {
  const OPEN = { id: 'as-1', status: 'open', program_id: 'prog-1', batch_id: null };
  const body = { assignmentId: 'as-1', submissionLink: 'https://drive.example/my-film' };

  it('accepts a submission for the learner’s own assignment', async () => {
    const d = db({ academy_assignments: OPEN, academy_assignment_submissions: null });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await SUBMIT(makeRequest('/api/academy/assignments/submit', { body, headers: withAuth() }));
    expect(res.status).toBe(200);
    expect(d.writes[0].payload.enrollment_id).toBe('enr-1');
    expect(d.writes[0].payload.status).toBe('submitted');
  });

  it('refuses an assignment belonging to another programme', async () => {
    const d = db({ academy_assignments: { ...OPEN, program_id: 'prog-OTHER' } });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await SUBMIT(makeRequest('/api/academy/assignments/submit', { body, headers: withAuth() }));
    expect(res.status).toBe(404);
    expect(d.writes).toHaveLength(0);
  });

  it('will not overwrite a graded submission', async () => {
    // Resubmitting after grading would erase the tutor's score and feedback.
    const d = db({
      academy_assignments: OPEN,
      academy_assignment_submissions: { id: 'sub-1', status: 'graded', score: 42 },
    });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await SUBMIT(makeRequest('/api/academy/assignments/submit', { body, headers: withAuth() }));
    expect(res.status).toBe(409);
    expect(d.writes).toHaveLength(0);
  });

  it('rejects an empty submission', async () => {
    vi.mocked(createAdminClient).mockReturnValue(db({ academy_assignments: OPEN }));
    const res = await SUBMIT(
      makeRequest('/api/academy/assignments/submit', {
        body: { assignmentId: 'as-1', submissionLink: '   ', submissionText: '' },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a link that is not a URL', async () => {
    vi.mocked(createAdminClient).mockReturnValue(db({ academy_assignments: OPEN }));
    const res = await SUBMIT(
      makeRequest('/api/academy/assignments/submit', {
        body: { assignmentId: 'as-1', submissionLink: 'javascript:alert(1)' },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('refuses a closed assignment', async () => {
    const d = db({ academy_assignments: { ...OPEN, status: 'closed' } });
    vi.mocked(createAdminClient).mockReturnValue(d);
    const res = await SUBMIT(makeRequest('/api/academy/assignments/submit', { body, headers: withAuth() }));
    expect(res.status).toBe(409);
    expect(d.writes).toHaveLength(0);
  });
});

describe('PATCH /api/admin/academy/submissions — grading', () => {
  const SUB = { id: 'sub-1', assignment_id: 'as-1', academy_assignments: { max_score: 50 } };

  it('records a valid score against the grader', async () => {
    const d = db({ academy_assignment_submissions: SUB });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await GRADE(
      makeRequest('/api/admin/academy/submissions', {
        method: 'PATCH',
        body: { submissionId: 'sub-1', score: 42, feedback: 'Strong coverage.' },
        headers: withAuth(),
      }),
    );

    expect(res.status).toBe(200);
    expect(d.writes[0].payload.score).toBe(42);
    expect(d.writes[0].payload.status).toBe('graded');
    expect(d.writes[0].payload.reviewed_by).toBe('admin-1');
  });

  it('rejects a score above the assignment’s maximum', async () => {
    // Rejected rather than clamped: 95 on a /50 brief is a typo worth surfacing,
    // and a silently clamped score corrupts any average computed from it.
    const d = db({ academy_assignment_submissions: SUB });
    vi.mocked(createAdminClient).mockReturnValue(d);

    const res = await GRADE(
      makeRequest('/api/admin/academy/submissions', {
        method: 'PATCH',
        body: { submissionId: 'sub-1', score: 95 },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(400);
    expect(d.writes).toHaveLength(0);
  });

  it('rejects a negative score', async () => {
    const d = db({ academy_assignment_submissions: SUB });
    vi.mocked(createAdminClient).mockReturnValue(d);
    const res = await GRADE(
      makeRequest('/api/admin/academy/submissions', {
        method: 'PATCH',
        body: { submissionId: 'sub-1', score: -1 },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('requires a score — grading with feedback alone is not grading', async () => {
    vi.mocked(createAdminClient).mockReturnValue(db({ academy_assignment_submissions: SUB }));
    const res = await GRADE(
      makeRequest('/api/admin/academy/submissions', {
        method: 'PATCH',
        body: { submissionId: 'sub-1', feedback: 'Nice' },
        headers: withAuth(),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ── Enrolment: the values written must be ones the database accepts ──────────

describe('ensureEnrollment — the row it writes', () => {
  it('stages a new enrolment as "enrolled", a real academy_candidate_stage label', async () => {
    // current_stage is a Postgres ENUM. An invalid label makes the insert fail, and
    // both callers swallow that failure so a payment never fails — so a wrong value
    // here means nobody ever enrols and learning never opens, silently. A mock
    // cannot check the enum, but it can pin the literal against drift.
    const VALID_STAGES = [
      'applied', 'approved', 'enrolled', 'online_in_progress', 'online_completed',
      'exam_eligible', 'exam_taken', 'exam_passed', 'exam_failed',
      'practical_invited', 'practical_confirmed', 'practical_completed',
    ];

    const writes: Array<Record<string, unknown>> = [];
    const supabase: any = {
      from: (table: string) => {
        const rows: Record<string, unknown> | null =
          table === 'academy_applications'
            ? { id: 'app-1', user_id: 'u1', batch_id: 'b1', status: 'approved', tuition_total_ngn: 0 }
            : table === 'academy_programs'
              ? { id: 'prog-1' }
              : null;
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: rows, error: null }),
          insert: (payload: Record<string, unknown>) => {
            writes.push(payload);
            const done: any = {
              select: () => done,
              single: async () => ({ data: { id: 'enr-1', program_id: 'prog-1' }, error: null }),
            };
            return done;
          },
        };
        return chain;
      },
    };

    const { ensureEnrollment } = await import('@/src/server/services/academy/enrollment');
    const result = await ensureEnrollment(supabase, 'app-1');

    expect(result.enrolled).toBe(true);
    expect(writes).toHaveLength(1);
    expect(VALID_STAGES).toContain(writes[0].current_stage);
    expect(writes[0].current_stage).toBe('enrolled');
  });
});

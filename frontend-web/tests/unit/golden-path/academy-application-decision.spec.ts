/**
 * FILM-003: admin decisions on a Film Academy application (approve/reject) never
 * notified the applicant — they only found out by polling GET /api/academy/application
 * in-app. This suite covers the notification side-effect added to
 * PATCH /api/admin/academy/applications/[id]:
 *
 *  1. Approving sends exactly one approval email to the applicant.
 *  2. Rejecting sends exactly one rejection email, including the rejection reason.
 *  3. A failed Supabase update must send NO email — the email is a side effect of a
 *     successful status change, never independent of it.
 *  4. A failed email send must never fail the PATCH response — the application
 *     status change is the source of truth.
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

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(), createClient: vi.fn() }));
vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn().mockResolvedValue({ role: 'admin', actorId: 'admin-1' }),
}));
vi.mock('@/src/server/services/academy/installments', () => ({
  autoCreateInstallmentPlan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/services/academy/enrollment', () => ({
  ensureEnrollment: vi.fn().mockResolvedValue(undefined),
}));

const sendTransactionalEmail = vi.fn().mockResolvedValue({ sent: true, provider: 'mailgun', id: 'msg-1' });
vi.mock('@/lib/email/transactional', () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendTransactionalEmail(...args),
}));

import { PATCH } from '../../../app/api/admin/academy/applications/[id]/route';
import { createAdminClient } from '@/lib/supabase/server';
import { assertAdminPermission } from '@/src/server/admin/auth';

type Rows = Record<string, unknown>;

const APPLICANT = {
  id: 'app-1',
  email: 'applicant@example.com',
  full_name: 'Ada Lovelace',
  batch_id: 'batch-1',
  tuition_total_ngn: 250000,
  rejection_reason: null as string | null,
};

/**
 * Builds an admin client stub whose `academy_applications` table:
 *  - `.update(...).eq(...).select().maybeSingle()` returns `updateResult`
 *    (the row returned by `updateAcademyApplicationReview`'s own update+select).
 *  - a later plain `.select('batch_id, academy_batches(batch_name)').eq().maybeSingle()`
 *    (used only on approval, to resolve the batch name) returns `batchLookupResult`.
 */
function makeAdminClient(updateResult: Rows | null, updateError: Rows | null = null, batchLookupResult: Rows | null = null) {
  return {
    from: (table: string) => {
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'admin-1' }, error: null }),
            }),
          }),
        };
      }
      if (table !== 'academy_applications') {
        throw new Error(`unexpected table: ${table}`);
      }
      const chain: any = {
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: updateResult, error: updateError }),
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: batchLookupResult, error: null }),
          }),
        }),
      };
      return chain;
    },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
    },
  } as any;
}

function patchRequest(body: Record<string, unknown>) {
  return makeRequest('/api/admin/academy/applications/app-1', {
    method: 'PATCH',
    body,
    headers: withAuth(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendTransactionalEmail.mockResolvedValue({ sent: true, provider: 'mailgun', id: 'msg-1' });
  vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'admin', actorId: 'admin-1' } as any);
});

describe('PATCH /api/admin/academy/applications/[id] — decision notifications', () => {
  it('sends exactly one approval email to the applicant on approval', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient(
        { ...APPLICANT, status: 'approved' },
        null,
        { batch_id: 'batch-1', academy_batches: { batch_name: 'Batch 7' } },
      ),
    );

    const res = await PATCH(patchRequest({ status: 'approved' }), { params: Promise.resolve({ id: 'app-1' }) });

    expect(res.status).toBe(200);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const [call] = sendTransactionalEmail.mock.calls;
    expect(call[0].to).toBe(APPLICANT.email);
    expect(call[0].subject).toContain('Approved');
  });

  it('sends exactly one rejection email including the rejection reason', async () => {
    const reason = 'Portfolio did not meet the minimum bar for this batch.';
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ ...APPLICANT, status: 'rejected', rejection_reason: reason }),
    );

    const res = await PATCH(
      patchRequest({ status: 'rejected', rejection_reason: reason }),
      { params: Promise.resolve({ id: 'app-1' }) },
    );

    expect(res.status).toBe(200);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const [call] = sendTransactionalEmail.mock.calls;
    expect(call[0].to).toBe(APPLICANT.email);
    expect(call[0].subject).toContain('Update on Your Spotlight Film Academy Application');
    expect(call[0].text).toContain(reason);
    expect(call[0].html).toContain(reason);
  });

  it('sends no email when the Supabase update fails', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient(null, { message: 'db is down', code: '500' }),
    );

    const res = await PATCH(patchRequest({ status: 'approved' }), { params: Promise.resolve({ id: 'app-1' }) });

    expect(res.status).toBe(500);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('still returns success when the email send fails', async () => {
    sendTransactionalEmail.mockRejectedValueOnce(new Error('mailgun down'));
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient(
        { ...APPLICANT, status: 'approved' },
        null,
        { batch_id: 'batch-1', academy_batches: { batch_name: 'Batch 7' } },
      ),
    );

    const res = await PATCH(patchRequest({ status: 'approved' }), { params: Promise.resolve({ id: 'app-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

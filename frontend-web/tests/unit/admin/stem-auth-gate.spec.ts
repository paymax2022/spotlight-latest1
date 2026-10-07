/**
 * STEM admin auth-gate regression.
 *
 * The admin STEM GET handlers used to call `assertStemReadAdmin(request)`
 * WITHOUT `await`. `assertAdminPermission` is async, so the rejection was an
 * unhandled promise and the handler served data anyway — an unauthenticated
 * 200 on /api/admin/stem/{applications,contests} (prod probe: 200 even with a
 * garbage x-admin-key; the [id] route then 500'd on a fake id).
 *
 * The same class was live on GET /api/stem/school-join-requests, which had NO
 * auth check at all and lists student PII (fullName, email, phone, uploads).
 *
 * These specs pin both: auth rejects → 401, never 200/500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn().mockRejectedValue(new ApiError('Unauthorized', 401)),
}));

// Persistence must NOT be reached when the gate holds — make every call throw
// so a bypass surfaces as a 500, not a silent 200.
vi.mock('@/src/server/stem/persistence', () => ({
  listApplications: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  listAdminContests: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  getContestById: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  createContest: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  updateContest: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  createSchoolJoinRequest: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  listSchoolJoinRequests: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
  reviewSchoolJoinRequest: vi.fn().mockRejectedValue(new Error('persistence reached — auth bypassed')),
}));

vi.mock('@/src/server/admin/audit', () => ({ addAuditEvent: vi.fn() }));

import { GET as applicationsGet } from '../../../app/api/admin/stem/applications/route';
import { GET as contestsGet } from '../../../app/api/admin/stem/contests/route';
import { GET as contestGet } from '../../../app/api/admin/stem/contests/[id]/route';
import { GET as joinRequestsGet } from '../../../app/api/stem/school-join-requests/route';

const req = (path: string) => new Request(`http://localhost${path}`, { method: 'GET' });
const ctx = (id: string) => ({ params: { id } });

describe('STEM admin routes reject unauthenticated callers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /api/admin/stem/applications → 401', async () => {
    const res = await applicationsGet(req('/api/admin/stem/applications'));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/stem/contests → 401', async () => {
    const res = await contestsGet(req('/api/admin/stem/contests'));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/stem/contests/[id] → 401 (not the old 500)', async () => {
    const res = await contestGet(req('/api/admin/stem/contests/abc'), ctx('abc'));
    expect(res.status).toBe(401);
  });

  it('GET /api/stem/school-join-requests → 401 (PII list)', async () => {
    const res = await joinRequestsGet(req('/api/stem/school-join-requests?schoolId=x'));
    expect(res.status).toBe(401);
  });
});

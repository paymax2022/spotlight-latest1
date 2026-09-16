/**
 * AD-015 gap: admin-queryable endpoint for the immutable voting audit trail.
 *
 * Endpoint under test: GET /api/admin/voting/{contestId}/audit-log
 *
 * `vote_audit_logs` (written via appendAuditLog, read via getAuditLogs in
 * src/server/voting/audit.service.ts — a brownfield-protected file, not
 * touched here) had no admin-facing route before this. This spec pins the
 * new route's auth gate, param handling, and response shape.
 *
 * Hermetic: Supabase + admin auth are mocked. No DB, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest, makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(),
}));

vi.mock('@/src/server/voting/audit.service', () => ({
  getAuditLogs: vi.fn(),
}));

import { GET as getAuditLog } from '../../../app/api/admin/voting/[contestId]/audit-log/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getAuditLogs } from '@/src/server/voting/audit.service';

function withParams(contestId: string) {
  return { params: Promise.resolve({ contestId }) };
}

function getRequest(url: string) {
  return makeRequest(url, { method: 'GET' });
}

describe('GET /api/admin/voting/{contestId}/audit-log (route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
  });

  it('requires the votes:manage admin permission', async () => {
    const req = getRequest('/api/admin/voting/c1/audit-log');
    await getAuditLog(req, withParams('c1'));

    expect(vi.mocked(assertAdminPermission)).toHaveBeenCalledWith(req, 'votes:manage');
  });

  it('returns 401 when assertAdminPermission rejects as unauthorized', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const req = getRequest('/api/admin/voting/c1/audit-log');
    const res = await getAuditLog(req, withParams('c1'));

    expect(res.status).toBe(401);
    expect(vi.mocked(getAuditLogs)).not.toHaveBeenCalled();
  });

  it('returns 403 when assertAdminPermission rejects as forbidden', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new Error('FORBIDDEN'));

    const req = getRequest('/api/admin/voting/c1/audit-log');
    const res = await getAuditLog(req, withParams('c1'));

    expect(res.status).toBe(403);
  });

  it('calls getAuditLogs with the contestId and parsed filters/pagination', async () => {
    vi.mocked(getAuditLogs).mockResolvedValueOnce([]);

    const req = getRequest(
      '/api/admin/voting/c1/audit-log?entityType=voting_settings&entityId=settings-1&limit=25&offset=50',
    );
    const res = await getAuditLog(req, withParams('c1'));

    expect(res.status).toBe(200);
    expect(vi.mocked(getAuditLogs)).toHaveBeenCalledWith('c1', {
      entityType: 'voting_settings',
      entityId: 'settings-1',
      limit: 25,
      offset: 50,
    });
  });

  it('defaults limit to 100 and offset to 0 when omitted', async () => {
    vi.mocked(getAuditLogs).mockResolvedValueOnce([]);

    const req = getRequest('/api/admin/voting/c1/audit-log');
    await getAuditLog(req, withParams('c1'));

    expect(vi.mocked(getAuditLogs)).toHaveBeenCalledWith('c1', {
      entityType: undefined,
      entityId: undefined,
      limit: 100,
      offset: 0,
    });
  });

  it('caps limit at 500 even if a larger value is requested', async () => {
    vi.mocked(getAuditLogs).mockResolvedValueOnce([]);

    const req = getRequest('/api/admin/voting/c1/audit-log?limit=10000');
    await getAuditLog(req, withParams('c1'));

    expect(vi.mocked(getAuditLogs)).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ limit: 500 }),
    );
  });

  it('returns the audit entries from getAuditLogs verbatim', async () => {
    const entries = [
      {
        id: 'log-1',
        actor_id: 'admin-1',
        actor_role: 'super_admin',
        action: 'leaderboard_frozen',
        entity_type: 'voting_settings',
        entity_id: 'c1',
        contest_id: 'c1',
        created_at: '2026-09-01T00:00:00.000Z',
      },
    ];
    vi.mocked(getAuditLogs).mockResolvedValueOnce(entries as any);

    const req = getRequest('/api/admin/voting/c1/audit-log');
    const res = await getAuditLog(req, withParams('c1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.contestId).toBe('c1');
    expect(body.entries).toEqual(entries);
  });

  it('propagates a getAuditLogs failure as a 500', async () => {
    vi.mocked(getAuditLogs).mockRejectedValueOnce(new Error('db unreachable'));

    const req = getRequest('/api/admin/voting/c1/audit-log');
    const res = await getAuditLog(req, withParams('c1'));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Integration against the real getAuditLogs implementation (mocked Supabase
// client only) — proves the route composes correctly with its dependency's
// actual query shape, not just a mocked module boundary.
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

describe('GET /api/admin/voting/{contestId}/audit-log (integration with real audit.service)', () => {
  it('queries vote_audit_logs scoped to the contest and returns rows', async () => {
    vi.resetModules();
    vi.doUnmock('@/src/server/voting/audit.service');

    const { createAdminClient } = await import('@/lib/supabase/server');
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValueOnce({
      data: [{ id: 'log-1', contest_id: 'c1', action: 'leaderboard_frozen' }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const { GET: getAuditLogReal } = await import('../../../app/api/admin/voting/[contestId]/audit-log/route');
    const { assertAdminPermission: assertAdminPermissionReal } = await import('@/src/server/admin/auth');
    vi.mocked(assertAdminPermissionReal).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);

    const req = getRequest('/api/admin/voting/c1/audit-log');
    const res = await getAuditLogReal(req, withParams('c1'));
    const body = await res.json();

    expect(mock.from).toHaveBeenCalledWith('vote_audit_logs');
    expect(mock.eq).toHaveBeenCalledWith('contest_id', 'c1');
    expect(res.status).toBe(200);
    expect(body.entries).toEqual([{ id: 'log-1', contest_id: 'c1', action: 'leaderboard_frozen' }]);
  });
});

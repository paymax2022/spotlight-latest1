/**
 * AD-015 (TS-14 admin portal batch 2) — immutable audit log explorer.
 *
 * `sec-009-audit-log.spec.ts` (Batch 1) proves the WRITE side: an admin
 * action (adjust, reverse) produces an entry in `vote_audit_logs` with the
 * real actor/action/before-after, and that no update/delete function exists
 * (append-only by construction). This covers the READ side —
 * `getAuditLogs()`, the function a queryable explorer would call — proving
 * an entry written for a given contest/contestant is actually retrievable,
 * filterable, and ordered newest-first.
 *
 * FINDING (documented, not fixed here — see test-plan notes for AD-015):
 * `getAuditLogs` has no consuming route anywhere in `frontend-web/app`. The
 * only two audit-log EXPLORER UIs that exist read from different, disconnected
 * stores:
 *   - `frontend-web/app/api/admin/audit-logs/route.ts` reads an in-memory,
 *     per-instance, 2000-row-capped generic admin event log
 *     (`src/server/admin/audit.ts`, `addAuditEvent`/`listAuditEvents`) used
 *     by ~28 unrelated admin modules — NOT `vote_audit_logs`.
 *   - `frontend-admin/app/admin/audit-logs/page.tsx` calls the Go backend's
 *     own `/api/admin/audit-logs` (a separate Postgres `audit_logs` table),
 *     also not `vote_audit_logs`.
 * So a voting admin action IS durably and immutably recorded (proven by
 * SEC-009 + this file), but there is currently no screen an admin can open
 * to query it. Wiring either explorer to `vote_audit_logs` is bigger than a
 * mechanical fix (new UI work in frontend-admin, or a schema/query change in
 * the Go backend) and is left flagged rather than built, per this batch's
 * scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { getAuditLogs } from '@/src/server/voting/audit.service';
import { createAdminClient } from '@/lib/supabase/server';

const CONTEST = 'contest-1';

describe('AD-015: getAuditLogs — the queryable read-path for the (unwired) audit explorer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns entries scoped to the requested contest, newest first, via the real query chain', async () => {
    const rows = [
      { id: 'log-2', action: 'admin_vote_adjustment', created_at: '2026-09-16T10:00:00Z' },
      { id: 'log-1', action: 'leaderboard_frozen', created_at: '2026-09-16T09:00:00Z' },
    ];
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValue({ data: rows, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const result = await getAuditLogs(CONTEST);

    expect(mock.from).toHaveBeenCalledWith('vote_audit_logs');
    expect(mock.eq).toHaveBeenCalledWith('contest_id', CONTEST);
    expect(mock.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual(rows);
  });

  it('can be filtered to a single entity (e.g. one contestant) for a scoped audit trail', async () => {
    // getAuditLogs chains .eq() again AFTER .range() when entityType/entityId
    // are given (real supabase-js query builders stay chainable post-range;
    // they're only awaited when the `then`/await happens). The shared
    // makeSupabaseMock() fixture treats .range() as terminal (it calls
    // listData() and returns a plain Promise) for routes that never chain
    // past it, so this test builds its own minimal thenable builder instead.
    const eq = vi.fn();
    const rows = [{ id: 'log-1' }];
    const builder: any = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      eq: (...args: unknown[]) => {
        eq(...args);
        return builder;
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => builder } as any);

    const result = await getAuditLogs(CONTEST, { entityType: 'vote_totals', entityId: 'contestant-1' });

    expect(eq).toHaveBeenCalledWith('contest_id', CONTEST);
    expect(eq).toHaveBeenCalledWith('entity_type', 'vote_totals');
    expect(eq).toHaveBeenCalledWith('entity_id', 'contestant-1');
    expect(result).toEqual(rows);
  });

  it('respects limit/offset for pagination through a large log', async () => {
    const { mock, rangeFn, listData } = makeSupabaseMock();
    listData.mockResolvedValue({ data: [], error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await getAuditLogs(CONTEST, { limit: 20, offset: 40 });

    expect(mock.limit).toHaveBeenCalledWith(20);
    expect(rangeFn).toHaveBeenCalledWith(40, 59);
  });

  it('surfaces a query failure instead of silently returning an empty (falsely "clean") log', async () => {
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(getAuditLogs(CONTEST)).rejects.toMatchObject({ message: 'connection reset' });
  });

  it('never returns undefined for an empty result — callers get [] not a crash', async () => {
    const { mock, listData } = makeSupabaseMock();
    listData.mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await expect(getAuditLogs(CONTEST)).resolves.toEqual([]);
  });
});

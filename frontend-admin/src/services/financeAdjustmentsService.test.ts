/**
 * WAL-004 — the missing checker-side UI for ADR-005 finance maker-checker.
 *
 * Covers the client contract against the real server routes
 * (GET/POST /api/v1/admin/adjustments...): correct URLs, status-filter
 * query param, camelCase row mapping, and the 409 (already decided) /
 * 403 (self-approval/self-rejection) surfacing that
 * app/admin/payments-finance/adjustments/page.tsx relies on to show a
 * "refresh, don't alarm" notice instead of a raw error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('financeAdjustmentsService', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown, status = 200) {
    const fn = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('listAdjustments hits the real endpoint and maps camelCase rows', async () => {
    const fetchFn = mockFetch({
      success: true,
      adjustments: [{
        id: 'adj-1', idempotencyKey: 'idem-1', initiatorId: 'u1', initiatorRole: 'finance_maker',
        targetUserId: 'u2', type: 'CREDIT', amountKobo: 10_000_000, reason: 'Large manual credit',
        status: 'pending_approval', checkerId: null, checkerRole: null, checkerNote: null,
        checkedAt: null, ledgerEntryId: null, createdAt: '2026-09-16T00:00:00Z',
      }],
    });
    const mod = await import('@/services/financeAdjustmentsService');
    const rows = await mod.listAdjustments({ status: 'pending_approval' });

    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/admin/adjustments');
    expect(String(url)).toContain('status=pending_approval');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'adj-1', type: 'CREDIT', amountKobo: 10_000_000, status: 'pending_approval' });
  });

  it('approveAdjustment posts to the approve route with an Idempotency-Key', async () => {
    const fetchFn = mockFetch({ success: true, adjustment: { adjustmentId: 'adj-1', ledgerEntryId: null } });
    const mod = await import('@/services/financeAdjustmentsService');
    await mod.approveAdjustment('adj-1');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/admin/adjustments/adj-1/approve');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('rejectAdjustment posts the checker note to the reject route', async () => {
    const fetchFn = mockFetch({ success: true });
    const mod = await import('@/services/financeAdjustmentsService');
    await mod.rejectAdjustment('adj-1', 'Reason looks fabricated');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/admin/adjustments/adj-1/reject');
    expect(JSON.parse(String(init.body))).toEqual({ checker_note: 'Reason looks fabricated' });
  });

  it('a 409 (already decided by another admin) surfaces as ApprovalActionError with status 409', async () => {
    mockFetch({ error: "Adjustment is already 'executed' — cannot approve" }, 409);
    const mod = await import('@/services/financeAdjustmentsService');
    await expect(mod.approveAdjustment('adj-1')).rejects.toMatchObject({ name: 'ApprovalActionError', status: 409 });
  });

  it('a 403 (self-approval) surfaces as ApprovalActionError with status 403 and the server message', async () => {
    mockFetch({ error: 'Self-approval is not permitted' }, 403);
    const mod = await import('@/services/financeAdjustmentsService');
    await expect(mod.approveAdjustment('adj-1')).rejects.toMatchObject({ name: 'ApprovalActionError', status: 403, message: 'Self-approval is not permitted' });
  });

  it('a 403 (self-rejection) surfaces the same way for reject', async () => {
    mockFetch({ error: 'Self-rejection is not permitted' }, 403);
    const mod = await import('@/services/financeAdjustmentsService');
    await expect(mod.rejectAdjustment('adj-1', 'Some note here')).rejects.toMatchObject({ name: 'ApprovalActionError', status: 403 });
  });
});

/**
 * WAL-004 — closing the wallet-adjustment maker-checker bypass.
 *
 * adjustWallet() used to POST straight to /api/admin/payments-finance/wallet/adjust,
 * which executed any amount immediately with no threshold and no second
 * approver. It now POSTs to the real ADR-005 maker-checker endpoint
 * (/api/v1/admin/adjustments — frontend-web/src/server/admin/fintech/service.ts),
 * translating field names/casing to that endpoint's contract and returning
 * its real response shape (status / requiresApproval / adjustmentId)
 * instead of the old bypass route's {reference, alreadyProcessed}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('paymentsFinanceAdminService.adjustWallet — ADR-005 maker-checker routing', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown, status = 201) {
    const fn = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('posts to the real /api/v1/admin/adjustments endpoint, never the old bypass route', async () => {
    const fetchFn = mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-1', status: 'executed', requiresApproval: false, alreadyProcessed: false },
    });
    const mod = await import('@/services/paymentsFinanceAdminService');
    await mod.adjustWallet('user-1', 'credit', 500, 'Refund for duplicate charge');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/admin/adjustments');
    expect(String(url)).not.toContain('/api/admin/payments-finance/wallet/adjust');
  });

  it('translates field names/casing to the real endpoint contract', async () => {
    const fetchFn = mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-2', status: 'executed', requiresApproval: false, alreadyProcessed: false },
    });
    const mod = await import('@/services/paymentsFinanceAdminService');
    await mod.adjustWallet('user-42', 'debit', 250.5, 'Manual correction per ticket #99');

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({
      target_user_id: 'user-42',
      type: 'DEBIT',
      amount_kobo: 25050,
      reason: 'Manual correction per ticket #99',
    });
    // Idempotency-Key header still carried, unchanged from the old bypass route.
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('translates credit direction to CREDIT type', async () => {
    const fetchFn = mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-3', status: 'executed', requiresApproval: false, alreadyProcessed: false },
    });
    const mod = await import('@/services/paymentsFinanceAdminService');
    await mod.adjustWallet('user-1', 'credit', 100, 'Goodwill credit for outage');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).type).toBe('CREDIT');
  });

  it('returns status=executed for amounts under the auto-execute threshold', async () => {
    mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-4', status: 'executed', requiresApproval: false, alreadyProcessed: false },
    });
    const mod = await import('@/services/paymentsFinanceAdminService');
    const result = await mod.adjustWallet('user-1', 'credit', 500, 'Small refund under threshold');
    expect(result.status).toBe('executed');
    expect(result.requiresApproval).toBe(false);
  });

  it('returns status=pending_approval for amounts at/above the threshold, without claiming money moved', async () => {
    mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-5', status: 'pending_approval', requiresApproval: true, alreadyProcessed: false },
    });
    const mod = await import('@/services/paymentsFinanceAdminService');
    const result = await mod.adjustWallet('user-1', 'credit', 500_000, 'Large manual credit above threshold');
    expect(result.status).toBe('pending_approval');
    expect(result.requiresApproval).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
  });

  it('rejects a reason shorter than the server minimum before ever calling the network', async () => {
    const fetchFn = mockFetch({});
    const mod = await import('@/services/paymentsFinanceAdminService');
    await expect(mod.adjustWallet('user-1', 'credit', 500, 'too short')).rejects.toThrow(/at least 10 characters/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces alreadyProcessed for a duplicate submission', async () => {
    mockFetch({
      success: true,
      adjustment: { adjustmentId: 'adj-6', status: 'pending_approval', requiresApproval: true, alreadyProcessed: true },
    }, 200);
    const mod = await import('@/services/paymentsFinanceAdminService');
    const result = await mod.adjustWallet('user-1', 'credit', 500_000, 'Large manual credit above threshold');
    expect(result.alreadyProcessed).toBe(true);
  });
});

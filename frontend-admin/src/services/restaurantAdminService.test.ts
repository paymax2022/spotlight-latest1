// @vitest-environment node
/**
 * The restaurant admin console must talk to the real backend BY DEFAULT.
 *
 * In fixture mode decideApplication mutates an in-memory array and returns
 * {ok:true}: a reviewer approves a restaurant's KYB, sees success, and
 * kyb_status never moves. Payout runs select `kyb_status = 'approved'`, so the
 * shop then stays unpayable with nothing indicating why — 709 outlets are in
 * that state today.
 *
 * A silent no-op that reports success is the worst shape this bug can take, so
 * the default is pinned by tests rather than by a comment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('restaurantAdminService — live by default', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs(); // nothing configured: what a real operator gets
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('approving an application reaches the network', async () => {
    const fetchFn = mockFetch({ ok: true });
    const mod = await import('@/services/restaurantAdminService');
    await mod.decideApplication('rest-1', 'approve', '');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/onboarding/rest-1/approve');
  });

  it('the moderation queue reads the real endpoint', async () => {
    const fetchFn = mockFetch({ listings: [] });
    const mod = await import('@/services/restaurantAdminService');
    await mod.listPendingListings();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/listings/pending');
  });

  it('a listing decision posts the decision and reason', async () => {
    const fetchFn = mockFetch({ ok: true });
    const mod = await import('@/services/restaurantAdminService');
    await mod.decideListing('rest-9', 'changes', 'Menu photos are unreadable');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/listings/rest-9/decision');
    expect(String(init.body)).toContain('Menu photos are unreadable');
  });

  it('refuses a negative decision with no reason, without calling the API', async () => {
    const fetchFn = mockFetch({ ok: true });
    const mod = await import('@/services/restaurantAdminService');
    await expect(mod.decideListing('rest-9', 'reject', '   ')).rejects.toThrow(/reason/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('still serves fixtures when an operator explicitly asks', async () => {
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK', 'true');
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/restaurantAdminService');
    await mod.listPendingListings();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

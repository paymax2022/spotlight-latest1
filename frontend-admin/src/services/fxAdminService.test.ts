import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The FX console's pricing rail. These specs pin it to the ONE FX admin surface
// the Go backend actually serves for pricing — GET/PUT
// /api/finance/admin/fx/markup (backend/internal/app/finance_routes.go,
// fx.MarkupHandler over public.fx_markup_rates) — because that table is the
// live markup resolver: a quote reads its spread from it on every request, so
// what the console shows and what customers pay are the same number.
// Fixture branches for pricing are the failure these specs exist to prevent:
// a fabricated bps on a pricing screen is indistinguishable from the real one.
describe('fxAdminService spread rail (live markup)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Deliberately NOT set to 'false': pricing must be live even when the rest
    // of the console is in fixture mode.
    delete process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const markupRow = {
    id: 'r-1',
    corridor: 'USD-NGN',
    tier: 'business',
    rateBps: 115,
    ratePercent: '1.15',
    active: true,
    updatedAt: '2026-11-19T12:00:00Z',
    createdAt: '2026-10-01T12:00:00Z',
  };

  it('reads spread rules from /api/finance/admin/fx/markup through the admin proxy', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [markupRow] }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/fxAdminService');

    const rows = await mod.getSpreadRules();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/admin-proxy/api/finance/admin/fx/markup');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'r-1', corridor: 'USD-NGN', tier: 'business', bps: 115, active: true });
  });

  it('takes the editable guard band from the markup ceiling, not from invented per-rule numbers', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [markupRow] }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/fxAdminService');

    const [rule] = await mod.getSpreadRules();

    // fx.MaxMarkupBPS is 10% and the table CHECKs it; the store projection has no
    // per-row min/max, so the console must guard against the real ceiling.
    expect(rule.minBps).toBe(0);
    expect(rule.maxBps).toBe(1000);
  });

  it('writes a bps edit back to the same rail as the percent the store keeps', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: markupRow }) }));
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/fxAdminService');

    await mod.updateSpreadRule(
      { corridor: 'USD-NGN', tier: 'business' },
      { bps: 115 },
    );

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/finance/admin/fx/markup');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toMatchObject({
      corridor: 'USD-NGN',
      tier: 'business',
      ratePercent: '1.15',
    });
  });

  it('surfaces the backend refusal instead of reporting a saved rule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'permission finance.admin.fx_markup is required' }),
    })));
    const mod = await import('@/services/fxAdminService');

    await expect(mod.getSpreadRules()).rejects.toThrow(/finance\.admin\.fx_markup/);
  });
});

/**
 * Every live read in this file used to be `const res = await fetch(...); return
 * res.json()` — no status check. Go answers an unmatched path with
 * {"success":false,"error":"No API route matches GET <path>"}
 * (backend/internal/app/noroute.go) and the admin proxy forwards that status and
 * body verbatim (app/api/admin-proxy/[...path]/route.ts), so those calls
 * RESOLVED an error object to the page, which then did rows.map(...) on it:
 * "This page couldn't load / Reload to try again, or go back". These specs pin
 * the opposite contract — a non-2xx must reject with the backend's own sentence,
 * so the console has a real thing to show.
 */
describe('fxAdminService live reads fail loud', () => {
  type Svc = typeof import('@/services/fxAdminService');

  beforeEach(() => {
    vi.resetModules();
    // Forced live: this is the production branch (NODE_ENV=production with the
    // flag unset resolves to the same thing), the one that was crashing.
    process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK = 'false';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK;
  });

  /**
   * Go's NoRoute body, served through the proxy with its status intact.
   *
   * The path in the sentence is the one Go receives, not the browser's: the proxy
   * forwards everything after /api/admin-proxy verbatim, so a request the console
   * makes to /api/admin-proxy/api/finance/admin/fx/transactions is refused as
   * "No API route matches GET /api/finance/admin/fx/transactions" — the exact
   * wording an operator needs to be able to grep in the backend. Stubbing the
   * browser path instead would have the test pass on a message nobody sees.
   */
  const noRoute = vi.fn(async (url: string) => ({
    ok: false,
    status: 404,
    json: async () => ({
      success: false,
      error: `No API route matches GET ${new URL(url).pathname.replace(/^\/api\/admin-proxy/, '')}`,
    }),
  }));

  const READS: [string, (m: Svc) => Promise<unknown>][] = [
    ['getTransactions', (m) => m.getTransactions()],
    ['getTransaction', (m) => m.getTransaction('tx_1')],
    ['getRoutingWeights', (m) => m.getRoutingWeights()],
    ['getProviders', (m) => m.getProviders()],
    ['getFloats', (m) => m.getFloats()],
    ['getRebalances', (m) => m.getRebalances()],
    ['getReconRuns', (m) => m.getReconRuns()],
    ['getReconBreaks', (m) => m.getReconBreaks()],
    ['getCustomers', (m) => m.getCustomers()],
    ['getCustomer', (m) => m.getCustomer('cus_1')],
    ['getScreeningAlerts', (m) => m.getScreeningAlerts()],
    ['getWebhookEndpoints', (m) => m.getWebhookEndpoints()],
    ['getWebhookDeliveries', (m) => m.getWebhookDeliveries()],
    ['getApiKeys', (m) => m.getApiKeys()],
    ['getAnalytics', (m) => m.getAnalytics()],
    ['getVaRegistry', (m) => m.getVaRegistry()],
    ['getCollectionEvents', (m) => m.getCollectionEvents()],
    ['getBeneficiaryIssues', (m) => m.getBeneficiaryIssues()],
    ['getIssuedCards', (m) => m.getIssuedCards()],
    ['getSuspiciousCardActivity', (m) => m.getSuspiciousCardActivity()],
    ['getCatalogue', (m) => m.getCatalogue()],
  ];

  for (const [name, call] of READS) {
    it(`${name} rejects with the backend route sentence instead of resolving the 404 body`, async () => {
      vi.stubGlobal('fetch', noRoute);
      const mod = await import('@/services/fxAdminService');

      await expect(call(mod)).rejects.toThrow(/No API route matches GET \/api\/finance\/admin\/fx\//);
    });
  }

  it('quotes the backend sentence for the overview rather than a canned status message', async () => {
    vi.stubGlobal('fetch', noRoute);
    const mod = await import('@/services/fxAdminService');

    // The operator-facing text on /admin/fx today is "Overview request failed
    // (404)", which hides which endpoint is missing. The backend already names it.
    await expect(mod.getOverview()).rejects.toThrow(/No API route matches GET \/api\/finance\/admin\/fx\/overview/);
  });

  it('passes a proxy-level failure through with the message the proxy sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'ADMIN_MIDDLEWARE_ENFORCE must not be disabled in production.' }),
    })));
    const mod = await import('@/services/fxAdminService');

    await expect(mod.getProviders()).rejects.toThrow(/ADMIN_MIDDLEWARE_ENFORCE/);
  });

  it('still unwraps the {data} envelope from a rail that does answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ customerId: 'cus_1', status: 'pending', accountType: 'business', tier: 2, email: 'ops@acme.example' }] }),
    })));
    const mod = await import('@/services/fxAdminService');

    const rows = await mod.getKycQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe('cus_1');
  });

  it('keeps fixtures for the dev branch only, where they are labelled as samples', async () => {
    vi.stubGlobal('fetch', noRoute);
    process.env.NEXT_PUBLIC_FX_ADMIN_USE_MOCK = 'true';
    const mod = await import('@/services/fxAdminService');

    // Guards against the hardening leaking into the mock branch and turning the
    // sample console into an error page.
    await expect(mod.getProviders()).resolves.toHaveLength(2);
  });
});

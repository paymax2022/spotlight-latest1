// @vitest-environment node
/**
 * Regression tests for the merchant-onboarding admin service.
 *
 * D9: `getApplication` must unwrap the Go admin API's `{ data: ... }` envelope
 * (same convention as the review-queue endpoint). Before the fix it returned the
 * raw envelope, so the detail page read `app.documents` / `app.checks` off the
 * wrong object and crashed with "Cannot read properties of undefined". These
 * tests pin the unwrap + its fallbacks so the regression can't come back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OnboardingApplication } from '@/types/onboarding';

describe('onboardingService.getApplication — live API shape (regression: D9)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Force the live fetch path instead of the fixture short-circuit.
    vi.stubEnv('NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown, ok = true, status = 200) {
    const fn = vi.fn(async () => ({ ok, status, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  // Re-import after stubbing env so module-load constants (USE_FIXTURES) pick it up.
  async function getApplication(id: string) {
    const mod = await import('@/services/onboardingService');
    return mod.getApplication(id);
  }

  const sampleApp = {
    id: 'app-1',
    status: 'SUBMITTED',
    merchantTypeName: 'Marketplace Seller',
    checks: [{ key: 'cac_doc', label: 'CAC certificate', status: 'failed' }],
    data: { store_name: 'Blue Yam Foods Ltd' },
  } as unknown as OnboardingApplication;

  it('unwraps the { data: ... } envelope so detail fields land on the returned object', async () => {
    const fetchFn = mockFetch({ data: sampleApp }); // Go API wraps payload in {data:...}
    const res = await getApplication('app-1');

    // The returned object is the application itself, not the envelope.
    expect(res).toEqual(sampleApp);
    // The exact fields the detail page reads must be present (were undefined pre-fix → crash).
    expect(res.checks).toHaveLength(1);
    expect((res as { data?: { store_name?: string } }).data?.store_name).toBe('Blue Yam Foods Ltd');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/admin/onboarding/applications/app-1');
  });

  it('falls back to the { application: ... } shape when there is no data envelope', async () => {
    // An application has no own `data` form-field here, so the .application
    // fallback resolves cleanly.
    const { data: _formData, ...appNoFormData } = sampleApp as Record<string, unknown>;
    mockFetch({ application: appNoFormData });
    expect(await getApplication('app-1')).toEqual(appNoFormData);
  });

  it('throws with the status code on a non-ok response', async () => {
    mockFetch({}, false, 500);
    await expect(getApplication('app-1')).rejects.toThrow(/500/);
  });
});

/**
 * The reviewer console must talk to the real engine BY DEFAULT.
 *
 * In fixture mode `postAction` simulates a decision: it waits 350ms and returns
 * an application echoing APPROVED. A reviewer sees success and nothing happens
 * server-side — no role granted, no merchant profile activated, no workspace
 * route written — while the real application stays SUBMITTED forever.
 *
 * A silent no-op that reports success is the worst shape a bug can take here, so
 * the default is pinned rather than left to a comment.
 */
describe('onboardingService — talks to the live engine by default', () => {
  beforeEach(() => {
    vi.resetModules();
    // Deliberately NOT stubbing NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK: this is
    // about what an operator gets with nothing configured.
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('approve reaches the network instead of simulating a decision', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 'app-1', status: 'APPROVED' } }) }));
    vi.stubGlobal('fetch', fetchFn);

    const mod = await import('@/services/onboardingService');
    await mod.approveApplication('app-1');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/api/admin/onboarding/applications/app-1/approve');
  });

  it('the review queue reads the real queue, not fixtures', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ applications: [] }) }));
    vi.stubGlobal('fetch', fetchFn);

    const mod = await import('@/services/onboardingService');
    const rows = await mod.listReviewQueue({});

    expect(fetchFn).toHaveBeenCalledTimes(1);
    // Fixtures are non-empty; an empty live response proves we read the network.
    expect(rows).toEqual([]);
  });

  it('still renders fixtures when an operator explicitly asks for them', async () => {
    vi.stubEnv('NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK', 'true');
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);

    const mod = await import('@/services/onboardingService');
    const rows = await mod.listReviewQueue({});

    expect(fetchFn).not.toHaveBeenCalled();
    expect(Array.isArray(rows)).toBe(true);
  });
});

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

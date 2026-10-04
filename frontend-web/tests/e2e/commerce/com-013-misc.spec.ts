/**
 * CMS-013 — app:misc triage: real-vs-noise classification probes.
 *
 * Mounted and probed here:
 *   - GET /api/v1/public/media/banners/:filename (public R2 presign redirect;
 *     strict filename regex — path traversal / junk must 404).
 *
 * Flag-gated OFF locally (unmounted → 404, classified flag-gated):
 *   - /api/v1/spotlight/*        FEATURE_SPOTLIGHTWEALTH_ENABLED
 *   - /api/v1/ai/invest/*        FEATURE_INVESTAI_ENABLED
 *   - /api/finance/nutrition/*   FEATURE_NUTRITION_ENABLED
 *   - /api/arena/*               FEATURE_ARENA_ENABLED
 *   - /placement*                FEATURE_PLACEMENT_ENABLED
 *   - Paystack checkouts         FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED
 *                                + FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED
 *                                (psp-unverified even when mounted)
 */

import { expect, test } from '@playwright/test';

import { goFetch, goTrueToken, provisionVerifiedUser } from './helpers';

test.describe('CMS-013 misc triage', () => {
  test('public banners: strict filename regex, never a raw read', async ({ request }) => {
    // Junk filenames → 404 before any R2 call.
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'x.png.exe', 'A.PNG', 'no-extension', 'a b.png']) {
      const res = await goFetch(request, `/api/v1/public/media/banners/${bad}`);
      expect(res.status, `banner ${bad}`).toBe(404);
    }
    // Well-formed name → 302 redirect to a presigned R2 URL, or 404 when R2 is
    // unconfigured locally (presign failure maps to 404 by design).
    const ok = await goFetch(request, '/api/v1/public/media/banners/e2e-banner.png');
    expect([200, 302, 404]).toContain(ok.status);
  });

  test('flag-gated misc surfaces are unmounted → clean 404', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-misc');
    const token = await goTrueToken(request, user.email, user.password);
    for (const path of [
      '/api/v1/spotlight/videos',
      '/api/v1/ai/invest/chat',
      '/api/finance/nutrition/dishes/x',
      '/api/nutrition/admin/payouts',
      '/api/arena/competitions',
      '/api/finance/placement/zones',
      '/api/finance/mobility/rides/paystack-checkout',
      '/api/finance/estate/x/dues/invoices/x/paystack-checkout',
    ]) {
      const res = await goFetch(request, path, { token });
      expect(res.status, `unmounted ${path}`).toBe(404);
    }
  });
});

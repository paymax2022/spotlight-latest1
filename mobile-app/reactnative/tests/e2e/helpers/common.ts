import { Page } from '@playwright/test';

/**
 * Stub the ambient endpoints every signed-in screen fires in the background.
 *
 * Why this exists: the axios interceptor in src/api/client.ts signs the user
 * out on ANY 401 (that's what kept bouncing earlier suites to /login). Module
 * hubs don't depend on these responses, but they MUST NOT hit the real proxy
 * with the seeded fake session — a 401 mid-test kills the screen under test.
 *
 * Cover these in every module spec; add module-specific mocks on top.
 */
export async function mockAmbientRequests(page: Page) {
  await page.route('**/api/v1/utility/logos**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { services: [] } }),
    });
  });

  // AuthGate push bridges (useVisitorPushBridge / useElectionPushBridge).
  await page.route('**/api/v1/visitor/notifications**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/v1/elections/active**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Saved payout beneficiaries — fetched by any PaymentActionScreen.
  await page.route('**/api/v1/beneficiaries', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { beneficiaries: [] } }),
    });
  });

  // Home-grid ambient queries. These are fired by home widgets and MUST NOT
  // 401 against a seeded fake session — the axios 401 interceptor signs the
  // user out, which kills the screen under test mid-flow (observed as the
  // home grid rendering, then the test timing out when a trailing 401 bounces
  // the SPA to /login). Mock them to empty-but-200 to stay inert.
  for (const url of [
    '**/api/finance/events/my/tickets**',
    '**/api/finance/events**',
    '**/api/v1/landing/placements**',
    '**/api/media/banners/**',
    '**/api/v1/wallet/balance**',
    '**/rest/v1/utility_transactions**',
  ]) {
    await page.route(url, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], items: [], events: [], placements: [], tickets: [], balance: 0 }),
      });
    });
  }
}

/**
 * Pin the published-module registry for gated surfaces.
 *
 * The root-layout guard (app/_layout.tsx → moduleKeyForSegments) reads
 * GET /api/v1/modules/visibility and redirects gated routes (/mobility →
 * 'transport', /stays → 'stays', /fractionalre → 'realtor') to
 * /module-unavailable when the registry answers WITHOUT the key; the
 * /property hub filters its pillars on the same answer. The call is
 * skipAuthRedirect and fails OPEN when the registry is unreachable — but a
 * live registry answering a list that lacks the key is a real redirect, so
 * specs for gated surfaces stub the answer rather than trust the backend.
 */
export async function mockModuleVisibility(page: Page, modules: string[]) {
  await page.route('**/api/v1/modules/visibility**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { environment: 'e2e', modules, comingSoon: [] },
      }),
    });
  });
}

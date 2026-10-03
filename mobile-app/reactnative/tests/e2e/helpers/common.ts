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
}

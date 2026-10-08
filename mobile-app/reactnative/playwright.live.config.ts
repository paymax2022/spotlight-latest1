import { defineConfig, devices } from '@playwright/test';

/**
 * LIVE-BACKEND lane — tests/e2e-live.
 *
 * Deliberately separate from playwright.config.ts: that suite (tests/e2e) is
 * 100% network-mocked and spins up its OWN Expo webServer with synthetic env.
 * This lane exercises the app as the orchestrator runs it — the Expo dev
 * server on :8083 serving a bundle whose .env resolves:
 *
 *   EXPO_PUBLIC_API_BASE_URL      → http://127.0.0.1:3000  (Next.js API proxy)
 *   EXPO_PUBLIC_SUPABASE_URL      → http://127.0.0.1:54321 (local GoTrue/PostgREST)
 *   EXPO_PUBLIC_TRANSFERS_USE_MOCK → true                  (PIN status is a
 *                                    localStorage read even here; /home is not
 *                                    a money route so it never gates these specs)
 *
 * No webServer block on purpose: the :8083 server is orchestrator-owned and
 * must not be spawned/killed by the test run. Override the target with
 * E2E_LIVE_BASE_URL if the app is served elsewhere.
 *
 * workers: 1 — every spec shares the one local Supabase and the one fixture
 * account (login attempts update platform_users.failed_login_attempts), so
 * serial is the only honest way to run this lane.
 */
export default defineConfig({
  testDir: './tests/e2e-live',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: {
    baseURL: process.env.E2E_LIVE_BASE_URL ?? 'http://127.0.0.1:8083',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // First navigation compiles the whole Metro bundle on a cold dev server.
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});

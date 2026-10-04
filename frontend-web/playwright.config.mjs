import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load the app env so specs can reach SUPABASE_SERVICE_ROLE_KEY for
// per-spec user provisioning (TEST-013). dotenv does NOT override vars that
// are already exported, so shell env always wins.
dotenv.config({ path: '.env.local' });

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  // Generous for local dev: `next dev` compiles each route on first hit, which
  // can take 10-30s on a cold cache. CI retries cover flakes; locally none.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          // .env.local now points GO_BACKEND_URL at :8080 (the real local Go
          // backend; :8095 was a dead port — E2E-ENV-001). This stays as a
          // defensive default so a spawned dev server still proxies correctly
          // if .env.local is absent. Passthrough: set GO_BACKEND_URL yourself.
          GO_BACKEND_URL: process.env.GO_BACKEND_URL || 'http://localhost:8080',
        },
      },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});

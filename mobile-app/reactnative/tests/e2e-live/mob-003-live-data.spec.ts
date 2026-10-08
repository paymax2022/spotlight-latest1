import { expect, test } from '@playwright/test';
import {
  attachNetLog,
  dumpNetLog,
  expectHome,
  findCalls,
  loginViaUI,
  NetEntry,
} from './helpers/live';

/**
 * MOB-003 — one real data flow: the home dashboard's wallet + profile reads.
 *
 * getDashboard() calls, all live:
 *   - GoTrue  GET :54321/auth/v1/user                  (fatal — auth check)
 *   - REST    GET :54321/rest/v1/user_profiles         (profile → greeting)
 *   - Next.js GET :3000/api/v1/wallet/balance          (primary wallet read —
 *             403 for this Tier-0 fixture: KYC-gated, which IS the live answer)
 *   - REST    GET :54321/rest/v1/wallet_balance        (fallback wallet read —
 *             mirrors the server's getBalance() over spendable account types)
 *   - REST    GET :54321/rest/v1/utility_transactions  (recent activity)
 *
 * Verdict evidence = the status codes observed on those URLs, plus the
 * rendered surface ('Total Balance', live greeting).
 */
test.describe('MOB-003 live data flow — home dashboard', () => {
  const netLog: NetEntry[] = [];

  test.afterEach(async ({}, testInfo) => {
    await dumpNetLog(testInfo, netLog);
    netLog.length = 0;
  });

  test('home renders wallet + profile served by the live stack', async ({ page }) => {
    attachNetLog(page, netLog);
    await loginViaUI(page);
    await expectHome(page);

    // Rendered surface: balance card + live profile greeting.
    await expect(page.getByText('Total Balance')).toBeVisible();
    await expect(page.getByText('Hello, QA')).toBeVisible();

    // Live evidence 1 — GoTrue accepted the session (the dashboard's fatal call).
    const userCalls = findCalls(netLog, /\/auth\/v1\/user/, 'GET').filter((c) =>
      c.host.endsWith(':54321'),
    );
    expect(userCalls.some((c) => c.status === 200), 'GET /auth/v1/user must be 200').toBeTruthy();

    // Live evidence 2 — profile row read directly from PostgREST.
    const profileCalls = findCalls(netLog, /\/rest\/v1\/user_profiles/);
    expect(
      profileCalls.some((c) => c.status === 200),
      'GET /rest/v1/user_profiles must be 200',
    ).toBeTruthy();

    // Live evidence 3 — the wallet read reached a REAL backend. Two legs:
    //   a) primary:   :3000/api/v1/wallet/balance  → 403 (KYC Tier-1 gate — the
    //      live answer for this unverified fixture, not a mock)
    //   b) fallback:  :54321/rest/v1/wallet_balance → 200 (Supabase view read)
    // Either leg alone proves the call left the app; both are asserted because
    // the fallback is what actually produced the rendered figure.
    const walletApi = findCalls(netLog, /\/api\/v1\/wallet\/balance/, 'GET');
    expect(
      walletApi.length,
      'expected the app to attempt /api/v1/wallet/balance on the live proxy',
    ).toBeGreaterThan(0);
    // Whatever the live server answered, record it — for this fixture it is the
    // documented 403 KYC gate; do not hard-require 403 in case the fixture is
    // later verified.
    console.log(`[mob-003] /api/v1/wallet/balance live status: ${walletApi.map((c) => c.status).join(', ')}`);

    const walletRest = findCalls(netLog, /\/rest\/v1\/wallet_balance/, 'GET');
    expect(
      walletRest.some((c) => c.status === 200),
      'GET /rest/v1/wallet_balance fallback must be 200',
    ).toBeTruthy();

    // Live evidence 4 — recent-activity feed read from PostgREST.
    const txCalls = findCalls(netLog, /\/rest\/v1\/utility_transactions/, 'GET');
    expect(
      txCalls.some((c) => c.status === 200),
      'GET /rest/v1/utility_transactions must be 200',
    ).toBeTruthy();
  });
});

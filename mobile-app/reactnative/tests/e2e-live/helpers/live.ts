import { expect, Page, TestInfo } from '@playwright/test';

/**
 * Shared helpers for the LIVE-BACKEND lane (tests/e2e-live).
 *
 * Unlike tests/e2e/helpers/*, NOTHING here stubs a route. Every request the
 * app makes is a real request to a real service; the helpers only observe.
 */

export const LIVE_USER = {
  email: 'qa-claude-test@spotlight.internal',
  password: 'LocalDevAdmin123!',
  // From the live user_profiles row — used to prove the profile read is real.
  firstName: 'QA',
};

/**
 * localStorage key the web build's supabase client persists the session under
 * (secureStorage prefixes `paymax_secure_` onto supabase-js's default
 * `sb-<host>-auth-token` for the 127.0.0.1 GoTrue host).
 */
export const SESSION_STORAGE_KEY = 'paymax_secure_sb-127-auth-token';

export type NetEntry = {
  method: string;
  host: string;
  path: string;
  status: number;
};

/** Hosts that count as the live backend for evidence purposes. */
const EVIDENCE_HOSTS = new Set(['127.0.0.1:3000', '127.0.0.1:54321', '127.0.0.1:8080', '127.0.0.1:54324', 'localhost:3000', 'localhost:54321', 'localhost:8080', 'localhost:54324']);

/**
 * Record every response the page receives from a live-backend host.
 * Attach BEFORE navigation. `log` is mutated in place; call
 * `dumpNetLog` in afterEach to attach it to the report.
 */
export function attachNetLog(page: Page, log: NetEntry[]) {
  page.on('response', (res) => {
    try {
      const u = new URL(res.url());
      if (!EVIDENCE_HOSTS.has(u.host)) return;
      log.push({
        method: res.request().method(),
        host: u.host,
        path: u.pathname + (u.search ? u.search.slice(0, 160) : ''),
        status: res.status(),
      });
    } catch {
      /* non-URL responses (data:, blob:) — ignore */
    }
  });
}

/** Find log entries whose path matches a regex (e.g. /\/api\/auth\/login/). */
export function findCalls(log: NetEntry[], pathRe: RegExp, method?: string): NetEntry[] {
  return log.filter((e) => pathRe.test(e.path) && (!method || e.method === method));
}

/** Attach the deduplicated network log to the test report as evidence. */
export async function dumpNetLog(testInfo: TestInfo, log: NetEntry[]) {
  const lines = log.map((e) => `${e.status} ${e.method.padEnd(6)} ${e.host}${e.path}`);
  await testInfo.attach('live-network-log', {
    body: lines.join('\n'),
    contentType: 'text/plain',
  });
  // Also emit to stdout so `list` reporter runs keep the evidence inline.
  console.log(`\n[network] ${log.length} live-backend calls for ${testInfo.title}`);
  for (const l of lines) console.log(`  ${l}`);
}

/**
 * Drive the REAL login UI: fill the identifier + password fields and tap
 * Sign In. Waits for the app to navigate to the authenticated home surface.
 * No route mocks — the request hits http://127.0.0.1:3000/api/auth/login.
 */
export async function loginViaUI(page: Page, email = LIVE_USER.email, password = LIVE_USER.password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByText('Sign In', { exact: true }).click();
}

/** Assert the authenticated home surface is up (post-login destination). */
export async function expectHome(page: Page) {
  // 'Explore Services' is the home grid header the mocked suite already uses;
  // it renders when the LIVE module-visibility registry exposes any service.
  await expect(page.getByText('Explore Services')).toBeVisible({ timeout: 30_000 });
}

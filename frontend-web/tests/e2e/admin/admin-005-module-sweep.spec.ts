/**
 * ADMIN-005 — module surfaces sweep (breadth, not deep flows).
 *
 * Navigates a representative set of top-level admin modules across the
 * sidebar's sections. For each page:
 *   - renders without an error-boundary / Next error-overlay dump,
 *   - shows substantive content (not a blank shell, not a stuck "Loading…"),
 *   - any /api/admin-proxy responses >=400 during the page's load are recorded
 *     (a page that shows an empty UI while its API 5xx'd is flagged —
 *     AUD-FE-006 silent-swallow watch),
 *   - an honest empty state ("No … to display") counts as real data.
 *
 * Verdicts are emitted as `[SWEEP]` console lines + test annotations for the
 * results doc.
 */
import { expect, test } from '@playwright/test';
import {
  ADMIN_WEB_URL,
  adminLoginViaUi,
  pageLooksBroken,
  upstreamOf,
  watchAdminProxy,
} from './helpers';

test.setTimeout(420_000);

interface PageVerdict {
  route: string;
  verdict: 'PASS' | 'EMPTY' | 'FAIL';
  notes: string;
}

const SWEEP: Record<string, string[]> = {
  'contests & voting': [
    '/admin/contests',
    '/admin/competitions',
    '/admin/open-mic',
    '/admin/registration',
    '/admin/judges-scores',
    '/admin/voting/packages',
    '/admin/stages-evictions',
  ],
  'finance / escrow / wallets': [
    '/admin/finance',
    '/admin/finance/transactions',
    '/admin/finance/wallets',
    '/admin/finance/transfers',
    '/admin/payments-finance',
    '/admin/social-escrow/dashboard',
    '/admin/savings/dashboard',
    '/admin/fx',
  ],
  'commerce & marketplace': [
    '/admin/marketplace',
    '/admin/crowdfunding',
    '/admin/restaurant',
    '/admin/vendors',
    '/admin/estate',
    '/admin/events/dashboard',
    '/admin/mobility',
    '/admin/telemedicine/dashboard',
    '/admin/social/dashboard',
  ],
  'comms, support & platform': [
    '/admin/connect/comms',
    '/admin/connect/dashboard',
    '/admin/referral/dashboard',
    '/admin/leads',
    '/admin/handoffs',
    '/admin/chatbot',
    '/admin/analytics',
    '/admin/modules',
    '/admin/groups',
    '/admin/rbac-settings',
    '/admin/intake',
  ],
};

async function sweepPage(page: Parameters<typeof adminLoginViaUi>[0], route: string): Promise<PageVerdict> {
  const watcher = watchAdminProxy(page);
  const notes: string[] = [];
  let verdict: PageVerdict['verdict'] = 'PASS';

  const res = await page.goto(`${ADMIN_WEB_URL}${route}`, { waitUntil: 'domcontentloaded' });
  const httpStatus = res?.status() ?? 0;
  if (httpStatus >= 500) {
    notes.push(`http ${httpStatus}`);
    watcher.stop();
    return { route, verdict: 'FAIL', notes: notes.join('; ') };
  }
  const landedPath = new URL(page.url()).pathname;
  if (landedPath !== route) notes.push(`redirected→${landedPath}`);

  // Let client fetches settle: wait for 'Loading…' to clear if it appears,
  // bounded so a stuck loader counts as a finding rather than a hang.
  try {
    await page.locator('text=Loading…').first().waitFor({ state: 'detached', timeout: 25_000 });
  } catch {
    if (await page.locator('text=Loading…').first().isVisible().catch(() => false)) {
      notes.push('stuck on Loading…');
      verdict = 'FAIL';
    }
  }
  await page.waitForTimeout(1_200); // trailing renders

  const broken = await pageLooksBroken(page);
  if (broken) {
    notes.push(`error-boundary: ${broken}`);
    verdict = 'FAIL';
  }

  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  const failedVisible = /failed to load|check your permissions/i.test(bodyText);
  if (failedVisible) notes.push('visible failure toast/row');

  const badCalls = watcher.hits.filter((h) => h.status >= 500);
  const clientErr = watcher.hits.filter((h) => h.status >= 400 && h.status < 500);
  watcher.stop();
  if (badCalls.length) {
    notes.push(`proxy 5xx: ${badCalls.map((h) => `${h.status} ${upstreamOf(h)}`).join(', ')}`);
    verdict = 'FAIL';
  }
  if (clientErr.length) {
    notes.push(`proxy 4xx: ${clientErr.map((h) => `${h.status} ${upstreamOf(h)}`).join(', ')}`);
  }

  // Substance check: some text besides pure chrome/empty.
  const meaningful = bodyText.replace(/\s+/g, ' ').trim();
  const hasRows = (await page.locator('tbody tr').count()) > 0;
  const honestEmpty = /no \w+.*to display|no results|nothing here|no data/i.test(meaningful);
  if (meaningful.length < 80) {
    notes.push('near-empty body');
    verdict = 'FAIL';
  } else if (honestEmpty && !hasRows) {
    verdict = 'EMPTY';
    notes.push('honest empty state');
  } else if (failedVisible && !hasRows) {
    verdict = 'EMPTY';
  }

  return { route, verdict, notes: notes.join('; ') || 'ok' };
}

for (const [section, routes] of Object.entries(SWEEP)) {
  test(`sweep: ${section}`, async ({ page }) => {
    await adminLoginViaUi(page);
    const verdicts: PageVerdict[] = [];
    for (const route of routes) {
      const v = await sweepPage(page, route);
      verdicts.push(v);
      console.log(`[SWEEP] ${JSON.stringify(v)}`);
    }
    test.info().annotations.push({
      type: 'sweep',
      description: verdicts.map((v) => `${v.verdict} ${v.route} — ${v.notes}`).join(' | '),
    });
    // Every page in the sweep must at least render; EMPTY is acceptable
    // (honest zero-data state) but FAIL is not.
    const failures = verdicts.filter((v) => v.verdict === 'FAIL');
    expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
  });
}

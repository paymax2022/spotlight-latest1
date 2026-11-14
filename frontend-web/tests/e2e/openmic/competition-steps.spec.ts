/**
 * Steps #01–#05 of the Open Mic programme page, against the local `open-mic-dev`
 * edition (see the plan's Task 7 — dev data, never programme data).
 *
 * The point is that a step is either live or says it is not: no control here may
 * point at a route that 401s, and nothing may print a number the admin switched
 * off. Run with --workers=1 (one `next dev` cannot serve parallel projects).
 *
 * Two limits of this file, so a red run is read correctly. It is a local gate
 * only — no CI workflow runs Playwright — and it runs against the fixture with
 * both admin switches ON, so the switch-off branches of design H2 are gated by
 * Task 5's unit tests (`showLeaderboard` / `showVoteCounts`), not here. And
 * Task 7's fixture submission window closes 2026-11-24: after that this spec
 * goes red on the calendar, not the code, so re-seed the fixture first.
 */
import { expect, test } from '@playwright/test';

const PAGE = '/service-details/open-mic-competition';
const SLUG = 'open-mic-dev';

async function openStep(page: import('@playwright/test').Page, step: 1 | 2 | 3 | 4 | 5) {
  await page.goto(`${PAGE}#step-${step}`);
  const panel = page.locator(`#step-${step}`);
  await expect(panel).toBeVisible();
  // Design F keeps the hash-to-accordion behaviour, so the page opens this step
  // itself once hydrated — wait for that rather than clicking. The earlier
  // "click only if it is not already open" helper is what failed: it read the
  // flag and then clicked, and hydration landing in the gap between those two
  // round trips made the click close what the feature had just opened, which is
  // why #step-1 collapsed alongside #step-3 and #step-5. Polling also gates the
  // behaviour itself — a hash handler that never opens anything now fails here
  // instead of being quietly clicked open by the test.
  await expect
    .poll(() => panel.evaluate((el) => (el as HTMLDetailsElement).open), {
      message: `#step-${step} must open from its own hash`,
    })
    .toBe(true);
  if (step !== 1) {
    // The other side of the same contract: SSR ships #step-1 open, so only the
    // hash handler opening this panel can close it. Asserting it pins the
    // exclusive accordion itself — a page that lost the `name` grouping would
    // still pass the check above.
    await expect
      .poll(() => page.locator('#step-1').evaluate((el) => (el as HTMLDetailsElement).open), {
        message: '#step-1 must close when the hash opens a later step',
      })
      .toBe(false);
  }
  return panel;
}

test('step 02 plays and downloads the real beat file', async ({ page }) => {
  const panel = await openStep(page, 2);
  const src = await panel.locator('audio source').getAttribute('src');
  expect(src, 'the player must use the public beat reader').toMatch(/^\/api\/open-mic\/beats\//);

  const inline = await page.request.get(src!);
  expect(inline.status()).toBe(200);
  expect(inline.headers()['content-type']).toContain('audio');

  const download = await panel.getByRole('link', { name: /download beat/i }).getAttribute('href');
  expect(download).toContain('?download=1');
  const head = await page.request.get(download!);
  expect(head.status()).toBe(200);
  expect(head.headers()['content-disposition']).toContain('attachment');
});

test('step 03 hands over to the real submission form while the window is open', async ({ page }) => {
  const panel = await openStep(page, 3);
  await expect(panel.getByRole('link', { name: /submit your song/i })).toHaveAttribute(
    'href',
    `/open-mic/${SLUG}/enter`,
  );
  await expect(panel, 'the real cap, not prose').toContainText('50MB');
});

test('step 04 is honest when nobody is signed in', async ({ page }) => {
  const panel = await openStep(page, 4);
  await expect(panel).toContainText(/appears here once your entry is live/i);
  await expect(panel.locator('a[href*="/entry/"]'), 'never a fabricated link').toHaveCount(0);
});

test('step 05 shows the top five with counts and a way to vote', async ({ page }) => {
  const panel = await openStep(page, 5);
  const rows = panel.locator('li[data-rank]');
  await expect(rows).toHaveCount(5);
  // Task 7's fixture board in rank order, pinned row by row. The vote count is
  // the requirement, not decoration — a board that names who is winning without
  // their votes has not answered step #05 — and pinning every row rather than
  // the two ends is what catches a board that repeats or shifts a middle value.
  // The word boundaries stop a padded 4120 from passing for 412. Each slug is
  // `slugifyArtist(stageName)`; every artist page answers 200 to an anonymous
  // reader and hosts the vote modal, so the row CTA lands where that one
  // artist's vote can actually be cast. Five links to one board would not be a
  // CTA "per each contestant" — design row #05, ruling 8-B.
  const standings = [
    { name: 'Adaeze Okonkwo', votes: /\b412\b/, slug: 'adaeze-okonkwo' },
    { name: 'Bello Miracle', votes: /\b388\b/, slug: 'bello-miracle' },
    { name: 'Tunde Signals', votes: /\b251\b/, slug: 'tunde-signals' },
    { name: 'K1ng$hoota', votes: /\b190\b/, slug: 'k1nghoota' },
    { name: 'Zabbymoney', votes: /\b96\b/, slug: 'zabbymoney' },
  ];
  await expect(rows.getByRole('link', { name: /^vote$/i })).toHaveCount(5);
  for (const [index, row] of standings.entries()) {
    const line = rows.nth(index);
    await expect(line).toContainText(row.name);
    await expect(line).toContainText(row.votes);
    await expect(line.getByRole('link', { name: /^vote$/i })).toHaveAttribute(
      'href',
      `/open-mic/${SLUG}/entry/${row.slug}`,
    );
  }
  await expect(panel.getByRole('link', { name: /vote now/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});

test('the closing call to action reaches the open mic board, not the STEM plane', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('a[href="/voting"]'), 'this page has nothing to do with /voting').toHaveCount(0);
  await expect(page.getByRole('link', { name: /go to voting/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});

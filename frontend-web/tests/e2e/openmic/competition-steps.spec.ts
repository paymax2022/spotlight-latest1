/**
 * Steps #01–#05 of the Open Mic programme page, against the local `open-mic-dev`
 * edition (see the plan's Task 7 — dev data, never programme data).
 *
 * The point is that a step is either live or says it is not: no control here may
 * point at a route that 401s, and nothing may print a number the admin switched
 * off. Run with --workers=1 (one `next dev` cannot serve parallel projects).
 */
import { expect, test } from '@playwright/test';

const PAGE = '/service-details/open-mic-competition';
const SLUG = 'open-mic-dev';

async function openStep(page: import('@playwright/test').Page, step: 1 | 2 | 3 | 4 | 5) {
  await page.goto(`${PAGE}#step-${step}`);
  const panel = page.locator(`#step-${step}`);
  await expect(panel).toBeVisible();
  // The page's own hash handler opens the linked accordion once hydrated; click
  // only if it has not, otherwise this would close what the feature just opened.
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
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
  await expect(rows.nth(0)).toContainText('Adaeze Okonkwo');
  // The requirement is the number, not just the name — a board that lists who is
  // winning without their votes has not answered step #05. Both ends of the slice
  // are pinned so a missing `public_vote_count` cannot hide behind row 1, and the
  // boundaries mean a padded 4120 or 960 cannot pass for the real counts.
  await expect(rows.nth(0)).toContainText(/\b412\b/);
  await expect(rows.nth(4)).toContainText(/\b96\b/);
  // Design table row 05: a Vote CTA per contestant, each into the edition board.
  await expect(rows.getByRole('link', { name: /^vote$/i })).toHaveCount(5);
  for (const rank of [1, 2, 3, 4, 5]) {
    await expect(rows.nth(rank - 1).getByRole('link', { name: /^vote$/i })).toHaveAttribute(
      'href',
      `/open-mic/${SLUG}/entries`,
    );
  }
  await expect(panel.getByRole('link', { name: /vote now/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});

test('the closing call to action reaches the open mic board, not the STEM plane', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('a[href="/voting"]'), 'this page has nothing to do with /voting').toHaveCount(0);
  await expect(page.getByRole('link', { name: /go to voting/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});

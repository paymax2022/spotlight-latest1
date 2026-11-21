import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { users } from '../helpers/testData';

/**
 * The home screen's contest shelf: the icon row that follows the daily-essentials
 * grid, holding Open Mic, Film Academy, Talent Hunt and Rising Star. The brief for
 * it was "a section called Contests just after Event Tickets, each tile linking to
 * the module already built", so the contract this suite holds is exactly that:
 *
 *   • placement — the row sits under the essentials grid's last tile and above the
 *     Refer & Earn strip. Measured on the rendered boxes rather than by a text
 *     match, because a row that exists in the wrong place is the failure the brief
 *     is about;
 *   • the registry gate — the three contest tiles ride the same `voteBridge` key
 *     as the Contest tile (they are views over the vote bridge, not separate
 *     platform_modules rows), so unpublishing it must retire them together. Film
 *     Academy rides `filmAcademy` and stays;
 *   • the destinations — Film Academy opens the hub that already lists every
 *     training area, and the three section tiles open their own section of the
 *     contest list, whose heading and empty state are the section's own words.
 *
 * The empty-state assertions are the honest ones: no Open Mic, Talent Hunt or
 * Rising Star contest is published anywhere yet, and the screen's job is to say so
 * in that section's terms instead of claiming no contests exist at all. The tiles
 * match on the contest an admin publishes (`src/features/voting/utils/
 * contestSections.ts`), because the connect list endpoint filters on status only
 * and its payload carries no category — so the section copy below is what a user
 * sees until that contest exists.
 *
 * The connect contests read is stubbed to an empty list on purpose. Voting
 * reads the live backend by default (EXPO_PUBLIC_VOTING_USE_MOCK is false), so an
 * unstubbed read against the pinned 127.0.0.1:3000 answers 401, isUnauthorized()
 * signs the fake session out and the goBack() lands on /login — the same trap
 * landing-banners.spec.ts documents for the KYC read.
 */
const SHELF = ['Open Mic', 'Film Academy', 'Talent Hunt', 'Rising Star'] as const;

// Everything the landing needs to render the way a fully published environment
// does, plus the two keys the shelf rides.
const PUBLISHED = [
  'wallet', 'walletTransfers', 'walletBankTransfers', 'fx',
  'utilityPayments', 'telemedicine', 'transport', 'restaurant', 'events',
  'referrals', 'voteBridge', 'filmAcademy',
];

const tile = (page: Page, label: string) =>
  page.getByRole('button', { name: label, exact: true });

async function openLanding(page: Page, modules: readonly string[] = PUBLISHED) {
  await mockAmbientRequests(page);
  await page.route('**/api/v1/connect/contests**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  // The Film Academy hub mounts its own reads the moment it opens.
  await page.route('**/api/academy/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
  });
  await mockWallet(page, users.funded.walletBalance);
  await mockModuleVisibility(page, [...modules]);
  await loginAs(page);
}

test.describe('Home contest shelf', () => {
  test.setTimeout(120_000);

  test('renders the four tiles between Event Tickets and Refer & Earn', async ({ page }) => {
    await openLanding(page);

    await expect(page.getByText('What’s on today?')).toBeVisible();
    await expect(page.getByText('Contests', { exact: true })).toBeVisible();
    for (const label of SHELF) {
      await expect(tile(page, label)).toBeVisible();
    }

    // Order, measured. The brief asks for one row of four tiles, so the row is
    // asserted as a row: all four share a baseline, read left to right in the
    // requested order, sit below the essentials grid's last tile, and leave the
    // Refer & Earn strip underneath the shelf.
    const events   = await tile(page, 'Event Tickets').boundingBox();
    const referral = await page.getByText('Bring your people along').boundingBox();
    expect(events).not.toBeNull();
    expect(referral).not.toBeNull();
    const boxes: Array<[string, { x: number; y: number; height: number }]> = [];
    for (const label of SHELF) {
      const box = await tile(page, label).boundingBox();
      expect(box, label + ' tile should be on screen').not.toBeNull();
      boxes.push([label, box!]);
    }
    for (const [, box] of boxes) {
      expect(box.y).toBe(boxes[0][1].y);
      expect(box.y).toBeGreaterThan(events!.y + events!.height);
    }
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i][1].x).toBeGreaterThan(boxes[i - 1][1].x);
    }
    expect(referral!.y).toBeGreaterThan(boxes[0][1].y + boxes[0][1].height);
  });

  test('unpublishing the contest module retires the three section tiles only', async ({ page }) => {
    const published = PUBLISHED.filter((k) => k !== 'voteBridge');
    await openLanding(page, published);

    for (const label of ['Open Mic', 'Talent Hunt', 'Rising Star'] as const) {
      await expect(tile(page, label)).toHaveCount(0);
    }
    // Film Academy is a different module and a different route, so it survives.
    await expect(tile(page, 'Film Academy')).toBeVisible();
  });

  test('a fully unpublished shelf leaves no orphan heading', async ({ page }) => {
    const published = PUBLISHED.filter((k) => k !== 'voteBridge' && k !== 'filmAcademy');
    await openLanding(page, published);

    await expect(page.getByText('Contests', { exact: true })).toHaveCount(0);
    await expect(tile(page, 'Film Academy')).toHaveCount(0);
    // The essentials row is untouched — this is about the shelf disappearing,
    // not the landing losing its head.
    await expect(tile(page, 'Event Tickets')).toBeVisible();
  });

  test('Open Mic and Rising Star open their own sections of the contest list', async ({ page }) => {
    await openLanding(page);

    // The section's own empty copy is the proof the tile resolved a section, not
    // just the list screen: without the param the screen reads 'No live contests
    // right now…'. The tile's label text is NOT used for this — expo-router keeps
    // the landing mounted behind the pushed screen, so 'Open Mic' is still in the
    // DOM, hidden, and a bare text locator resolves to that dead node first.
    await tile(page, 'Open Mic').click();
    await expect(page).toHaveURL(/\/voting\/contests\?section=open-mic$/);
    await expect(page.getByText('No Open Mic contest is running right now…')).toBeVisible();

    await page.goBack();
    await expect(tile(page, 'Rising Star')).toBeVisible();
    await tile(page, 'Rising Star').click();
    await expect(page).toHaveURL(/\/voting\/contests\?section=rising-star$/);
    await expect(page.getByText('Rising Star is not open yet…')).toBeVisible();
  });

  test('Film Academy opens the hub that lists every training area', async ({ page }) => {
    await openLanding(page);

    await tile(page, 'Film Academy').click();
    await expect(page).toHaveURL(/\/film-academy/);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { users } from '../helpers/testData';

/**
 * The landing page's promotional banner carousel, which sits directly under the
 * Refer & Earn strip and replaces the single Film Academy panel that used to be
 * there. Each slide is a finished piece of artwork that names one service and
 * one action, so the contract this suite holds is the pairing: the artwork a
 * user sees is the service the tap delivers. A carousel whose slides all land on
 * the same hub, or whose offscreen pages cannot be reached, is decoration
 * wearing a navigation control's clothes.
 *
 * What holds the carousel to being a carousel:
 *   • it moves on its own — every four seconds the row pages to the next
 *     campaign and wraps back to the first, which is what makes five banners fit
 *     in one strip. A press, a drag or a resting cursor pauses it, because a
 *     panel that shifts under a finger that is aiming at a banner is how a user
 *     ends up somewhere they did not choose;
 *   • the snap — react-native-web turns pagingEnabled into
 *     scroll-snap-type: x mandatory on the scroll container, so the row cannot
 *     come to rest between two campaigns. This is the assertion that actually
 *     distinguishes a pager from a plain horizontal ScrollView: with
 *     pagingEnabled deleted, the five full-width pages still sit side by side
 *     and every position check below still passes (mutation-proved on this
 *     lane), so the snap is checked on its own;
 *   • one banner per screen — consecutive slides are exactly one viewport apart,
 *     so the row pages instead of stacking five banners down the landing;
 *   • the registry gate — unpublishing a module in /admin/modules removes its
 *     banner, the same rule the essentials row and the hero tiles follow.
 *
 * The alt text is the artwork's own copy (each banner is 1774x887 and carries
 * its headline and CTA baked in), which is also the accessible name the tap is
 * found by.
 */
const BANNERS = [
  { alt: 'Send money to bank accounts and wallets',                     url: /\/services\/transfer$/ },
  { alt: 'Sell on the Marketplace — list your products',                url: /\/marketplace\/sell$/ },
  { alt: 'Pay airtime, data, electricity and cable TV bills',           url: /\/services\/bills$/ },
  { alt: 'Film Academy — hands-on training, mentorship and careers',    url: /\/film-academy$/ },
  { alt: 'Renew your DStv, StarTimes or GOtv subscription',             url: /\/services\/cable-tv$/ },
] as const;

// Every banner's own gate, plus the keys the rest of the landing needs so the
// screen renders the way it does for a fully published environment.
const PUBLISHED = [
  'wallet', 'walletTransfers', 'walletBankTransfers', 'fx',
  'utilityPayments', 'marketplace', 'filmAcademy', 'referrals',
];

async function openLanding(page: Page, modules: readonly string[] = PUBLISHED) {
  await mockAmbientRequests(page);
  // The five banners are navigation, so this test walks into each destination
  // screen and back. Those screens fire their own reads the moment they mount,
  // and an unstubbed one goes to whatever the developer has listening on
  // EXPO_PUBLIC_API_BASE_URL / Supabase: with the fixture JWT the real BFF and
  // PostgREST both answer 401, isUnauthorized() → promptSignIn() signs the
  // session out, and the goBack() at the end of the loop lands on /login instead
  // of the landing. Measured in this lane's own trace: GET /api/finance/kyc/me
  // (bills + cable TV mount their KYC step-up check) and
  // GET /rest/v1/utility_billers?category=eq.cable_tv. Serving inert 200s keeps
  // the suite independent of local port state, which is what helpers/bills.ts
  // already does for the bills lane; only the URL under test matters here, not
  // what these screens list.
  await page.route('**/api/finance/kyc/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          kyc_tier: 1,
          kyc_status: 'verified',
          requested_tier: null,
          phone_verified: true,
          kyc_submitted_at: '2026-06-01T00:00:00.000Z',
          kyc_verified_at: '2026-06-01T00:00:00.000Z',
        },
      }),
    });
  });
  await page.route('**/rest/v1/utility_billers**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/academy/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
  });
  await mockWallet(page, users.funded.walletBalance);
  await mockModuleVisibility(page, [...modules]);
  await loginAs(page);
}

const banner = (page: Page, alt: string) =>
  page.getByRole('button', { name: alt, exact: true });

const pager = (page: Page) => page.getByTestId('landing-banner-pager');

/**
 * Which page the row is snapped to, read from the scroll container itself. This
 * is the only way to see autoplay: the row moves without any input, so a
 * locator state (dots, aria) would be a second thing to trust rather than the
 * movement itself.
 */
const snappedPage = (page: Page) =>
  pager(page).evaluate((el) => Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));

/**
 * Hold the row still. A cursor resting on the carousel pauses it — the same
 * reason a press pauses it — so any test that needs a fixed page can measure one
 * without racing the four-second clock.
 */
const holdStill = async (page: Page) => {
  await pager(page).hover();
};

test.describe('Landing banner carousel', () => {
  // Five banners means five navigate-and-go-back round trips in one test, and
  // each one re-renders the landing from a dev-mode Metro bundle. The suite
  // default (45s) is sized for a single navigation, so give this lane headroom.
  test.setTimeout(150_000);

  test('pages the five service banners under the Refer & Earn strip', async ({ page }) => {
    await openLanding(page);

    await expect(page.getByText('Bring your people along')).toBeVisible();

    // The pager itself, not a slide: it must snap to a page boundary. Deleting
    // pagingEnabled leaves every position check in this test passing — a plain
    // horizontal ScrollView lays the same five full-width pages in a row — so
    // this is the assertion that carries the word "carousel".
    await expect(page.getByTestId('landing-banner-pager'))
      .toHaveCSS('scroll-snap-type', 'x mandatory');

    for (const { alt } of BANNERS) {
      await expect(banner(page, alt)).toBeVisible();
    }

    // One banner per screen, measured so the four-second clock cannot change the
    // answer: consecutive slides sit exactly one viewport apart, so the row
    // pages instead of stacking five banners down the landing. Absolute x would
    // say the same thing only while the row happens to be snapped to page 0.
    await holdStill(page);
    const pageWidth = await pager(page).evaluate((el) => el.clientWidth);
    const xs: number[] = [];
    for (const { alt } of BANNERS) {
      const box = await banner(page, alt).boundingBox();
      expect(box).not.toBeNull();
      xs.push(box!.x);
    }
    for (let i = 1; i < xs.length; i += 1) {
      const gap = xs[i] - xs[i - 1];
      expect(gap).toBeGreaterThanOrEqual(pageWidth * 0.95);
      expect(gap).toBeLessThanOrEqual(pageWidth * 1.05);
    }

    // The carousel sits below the referral strip, where the old panel was.
    const referral = await page.getByText('Bring your people along').boundingBox();
    const first = await banner(page, BANNERS[0].alt).boundingBox();
    expect(first?.y).toBeGreaterThan(referral?.y ?? 0);

    // ...and the panel it replaced is gone, so the landing does not show the
    // same Film Academy route twice.
    await expect(page.getByText('Discover Film Academy')).toHaveCount(0);
  });

  test('moves to the next campaign on its own, every four seconds', async ({ page }) => {
    await openLanding(page);
    // The cursor must not be on the row: resting there is the hold-still signal,
    // and this test is about the row moving without being asked.
    await page.mouse.move(0, 0);

    // It starts on the first campaign rather than jumping mid-list.
    expect(await snappedPage(page)).toBe(0);

    // One tick, then the next. Each poll is bounded well below the point where a
    // slower interval could pass it, so this measures the four-second rhythm
    // rather than just "it moved sometime".
    await expect
      .poll(() => snappedPage(page), { timeout: 8_000 })
      .toBe(1);
    await expect
      .poll(() => snappedPage(page), { timeout: 8_000 })
      .toBe(2);
  });

  test('wraps back to the first campaign instead of stopping at the last', async ({ page }) => {
    await openLanding(page);
    await page.mouse.move(0, 0);

    // Walk the whole list: four ticks to reach the last slide, then the tick that
    // has to bring the row home. Bounded by the number of banners, so a carousel
    // that stops at the end cannot pass.
    await expect
      .poll(() => snappedPage(page), { timeout: 8_000 * (BANNERS.length - 1) })
      .toBe(BANNERS.length - 1);
    await expect
      .poll(() => snappedPage(page), { timeout: 12_000 })
      .toBe(0);
  });

  test('a cursor on the row holds it still', async ({ page }) => {
    await openLanding(page);
    await holdStill(page);

    const at = await snappedPage(page);
    // Longer than one interval, so a row that ignores the pause has had two
    // chances to move.
    await page.waitForTimeout(9_000);
    expect(await snappedPage(page)).toBe(at);
  });

  test('each banner opens the service it advertises', async ({ page }) => {
    await openLanding(page);

    for (const { alt, url } of BANNERS) {
      const slide = banner(page, alt);
      // Hold the row before reaching for it. Without this the four-second clock
      // can page between scrolling a slide into view and the click landing on
      // it, which would make this test fail for a reason that is not the
      // artwork-to-destination pairing it exists to check.
      await holdStill(page);
      // Offscreen pages must be scrolled into view first, the way a swipe does.
      await slide.scrollIntoViewIfNeeded();
      await slide.click();
      await expect(page).toHaveURL(url);

      await page.goBack();
      // Same headroom the hero-card lane gives this anchor: dev-mode Metro
      // remounts the landing after each round trip.
      await expect(page.getByPlaceholder('Find a service')).toBeVisible({ timeout: 20_000 });
    }
  });

  test('unpublishing a module drops its banner', async ({ page }) => {
    // marketplace, utilityPayments (bills + cable TV) withdrawn; transfers and
    // the academy stay published.
    await openLanding(page, ['wallet', 'walletTransfers', 'walletBankTransfers', 'fx', 'filmAcademy']);

    await expect(banner(page, BANNERS[0].alt)).toBeVisible();
    await expect(banner(page, BANNERS[3].alt)).toBeVisible();

    for (const i of [1, 2, 4]) {
      await expect(banner(page, BANNERS[i].alt)).toHaveCount(0);
    }
  });
});

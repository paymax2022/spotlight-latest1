/**
 * Site header — the top-right hamburger is the only route to sign in / register
 * on the marketing pages.
 *
 * Three chrome families open a hamburger today: the template pages (`/about`,
 * `/sponsor`, …) open the Infotek offcanvas from `Layout`, and the three
 * mock-built headers (`/`, `/season-2`, the application routes) open
 * components/marketing/HeaderDrawer — the same modal mechanism (a panel that
 * slides in from the right over a dimmed, scroll-locked page, closed by its own
 * button, the backdrop, Escape, or any link), painted with each page's own
 * tokens and carrying that page's nav plus the account group.
 */

import { expect, test, type Page } from '@playwright/test';
import { loginViaApi } from './helpers/auth';

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1100, height: 900 },
  { width: 900, height: 900 },
];

const PANEL = '.hdr-drawer__panel';
const BACKDROP = '.hdr-drawer__backdrop';

/** Opens the themed drawer and waits for the slide to have started. */
async function openDrawer(page: Page, toggle: string) {
  await page.locator(toggle).click();
  await expect(page.locator(PANEL)).toHaveClass(/is-open/);
}

/**
 * The hamburger has to be the header's furthest-right item: the drawer it opens
 * slides in over the right edge, so a call to action parked out there reads as
 * the panel's own control. The CTA sits to its left instead.
 */
async function expectFurthestRight(page: Page, toggle: string) {
  const intruder = await page.locator(toggle).evaluate((el) => {
    const row = el.closest('.header-main, .nav-shell, .header-inner') ?? el.closest('header')!;
    const right = el.getBoundingClientRect().right;
    for (const node of Array.from(row.querySelectorAll('*'))) {
      if (node === el || node.contains(el) || el.contains(node)) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (box.right > right + 1) return `${node.tagName}.${String(node.className)}`;
    }
    return '';
  });
  expect(intruder).toBe('');
}

function marketingDrawerSpecs(
  title: string,
  path: string,
  root: string,
  cta: RegExp,
  navLink: RegExp,
) {
  const toggle = `${root} .menu-toggle`;
  const panel = `${root} ${PANEL}`;
  const backdrop = `${root} ${BACKDROP}`;

  test.describe(title, () => {
    test.use({ viewport: WIDTHS[0] });

    for (const viewport of WIDTHS) {
      test(`shows the hamburger at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(path);
        await expect(page.locator(toggle)).toBeVisible();
        await expectFurthestRight(page, toggle);
      });
    }

    test('the hamburger stays the furthest-right item with the drawer open', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await openDrawer(page, toggle);
      await expectFurthestRight(page, toggle);
    });

    test('hamburger slides the drawer in and dims the page behind it', async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(panel)).not.toHaveClass(/is-open/);
      await expect(page.locator(backdrop)).toBeHidden();

      await openDrawer(page, toggle);
      await expect(page.locator(backdrop)).toBeVisible();
      // A modal drawer parks the page: the scroll position stays put under it.
      await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    });

    test('drawer carries the page nav and the account group', async ({ page }) => {
      await page.goto(path);
      await openDrawer(page, toggle);
      await expect(page.locator(panel).getByText('Account', { exact: true })).toBeVisible();
      await expect(page.locator(panel).getByRole('link', { name: navLink })).toBeVisible();
    });

    test('signed-out drawer offers sign in and register', async ({ page }) => {
      await page.goto(path);
      await openDrawer(page, toggle);
      const links = page.locator(panel);
      await expect(links.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login');
      await expect(links.getByRole('link', { name: /create an account/i })).toHaveAttribute(
        'href',
        '/login?tab=signup',
      );
    });

    test('signed-in drawer swaps sign in for the account links', async ({
      page,
      context,
      request,
    }) => {
      await loginViaApi(context, request);
      await page.goto(path);
      await openDrawer(page, toggle);
      const links = page.locator(panel);
      await expect(links.getByRole('link', { name: /my dashboard/i })).toHaveAttribute(
        'href',
        '/user-dashboard',
      );
      await expect(links.getByRole('link', { name: /my applications/i })).toHaveAttribute(
        'href',
        '/user-dashboard?tab=applications',
      );
      await expect(links.getByRole('button', { name: /sign out/i })).toBeVisible();
      await expect(links.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
    });

    test('close button, backdrop click and Escape each shut the drawer', async ({ page }) => {
      await page.goto(path);

      await openDrawer(page, toggle);
      await page.locator(`${root} .hdr-drawer__close`).click();
      await expect(page.locator(panel)).not.toHaveClass(/is-open/);
      await expect(page.locator(backdrop)).toBeHidden();
      await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');

      await openDrawer(page, toggle);
      await page.locator(backdrop).click({ position: { x: 40, y: 300 } });
      await expect(page.locator(panel)).not.toHaveClass(/is-open/);

      await openDrawer(page, toggle);
      await page.keyboard.press('Escape');
      await expect(page.locator(panel)).not.toHaveClass(/is-open/);
    });

    test('a drawer link shuts the drawer and navigates', async ({ page }) => {
      await page.goto(path);
      await openDrawer(page, toggle);
      await page.locator(panel).getByRole('link', { name: /^sign in$/i }).click();
      await expect(page).toHaveURL(/\/login/);
    });

    test('the drawer call to action closes it and opens its dialog', async ({ page }) => {
      await page.goto(path);
      await openDrawer(page, toggle);
      await page.locator(panel).getByRole('button', { name: cta }).click();
      await expect(page.locator(panel)).not.toHaveClass(/is-open/);
      await expect(page.locator('dialog[open]')).toBeVisible();
    });

    test('hamburger still opens the drawer after scrolling', async ({ page }) => {
      await page.goto(path);
      await page.mouse.wheel(0, 600);
      await expect(page.locator(toggle)).toBeVisible();
      await openDrawer(page, toggle);
    });
  });
}

marketingDrawerSpecs('landing home header', '/', '.sp-home', /find your spotlight/i, /our programmes/i);
marketingDrawerSpecs('season-2 header', '/season-2', '.sp-season2', /register for season 2/i, /the mansion/i);

function templateHeaderSpecs(
  title: string,
  path: string,
  { auth = false, account = { name: /^sign in$/i, href: '/login' } }: {
    auth?: boolean;
    account?: { name: RegExp; href: string };
  } = {},
) {
  const panel = '.offcanvas__info';
  test.describe(title, () => {
    test.use({ viewport: WIDTHS[0] });

    if (auth) {
      test.beforeEach(async ({ context, request }) => {
        await loginViaApi(context, request);
      });
    }

    for (const viewport of WIDTHS) {
      test(`shows the hamburger at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(path);
        const toggle = '.header__hamburger .sidebar__toggle';
        await expect(page.locator(toggle)).toBeVisible();
        await expectFurthestRight(page, toggle);
      });
    }

    test('hamburger slides the offcanvas in with its account link', async ({ page }) => {
      await page.goto(path);
      await page.locator('.header__hamburger .sidebar__toggle').click();
      await expect(page.locator(panel)).toHaveClass(/info-open/);
      await expect(page.locator('.offcanvas__overlay')).toHaveClass(/overlay-open/);
      await expect(page.locator(panel).getByRole('link', { name: account.name })).toHaveAttribute(
        'href',
        account.href,
      );
    });

    test('offcanvas close button and overlay shut it', async ({ page }) => {
      await page.goto(path);
      await page.locator('.header__hamburger .sidebar__toggle').click();
      await page.locator('.offcanvas__close').click();
      await expect(page.locator(panel)).not.toHaveClass(/info-open/);

      await page.locator('.header__hamburger .sidebar__toggle').click();
      await page.locator('.offcanvas__overlay').click({ position: { x: 100, y: 300 } });
      await expect(page.locator(panel)).not.toHaveClass(/info-open/);
    });

    test('hamburger is still visible once the header is sticky', async ({ page }) => {
      await page.goto(path);
      // The sticky class only lands on a scroll event the hydrated header hears,
      // so keep scrolling until it takes — one scroll can race past hydration.
      let top = 800;
      await expect
        .poll(async () => {
          top += 20;
          await page.evaluate((offset) => window.scrollTo(0, offset), top);
          return (await page.locator('#header-sticky').getAttribute('class')) ?? '';
        })
        .toContain('sticky');
      await expect(page.locator('.header__hamburger .sidebar__toggle')).toBeVisible();
    });
  });
}

templateHeaderSpecs('template header /about', '/about');
templateHeaderSpecs('template header /service-details/stem-contest', '/service-details/stem-contest');

// /apply/sme-pitch-contest used to carry the bespoke Season 2 ApplicationHeader;
// it now uses the site Header1 + offcanvas like every other marketing page. The
// route is auth-gated (it redirects to /login), so these cases sign in first, and
// the signed-in drawer offers the profile link rather than sign in / register.
templateHeaderSpecs('template header /apply/sme-pitch-contest', '/apply/sme-pitch-contest', {
  auth: true,
  account: { name: /view full profile/i, href: '/user-dashboard' },
});

// The page keeps only its skip link as in-page nav, and it has no season rail, so
// the header going fixed must not cover the top of the form it lands on.
test.describe('sme-pitch apply skip link', () => {
  test.use({ viewport: WIDTHS[0] });

  test('lands the form below the sticky header', async ({ page, context, request }) => {
    await loginViaApi(context, request);
    await page.goto('/apply/sme-pitch-contest');
    await expect(page.locator('#header-sticky')).toBeVisible();
    // The wizard paints its first step after it has the saved entry, which
    // makes the page considerably taller. Jumping before that settles measures
    // a layout nobody sees.
    await expect(page.getByRole('heading', { name: /how are you entering/i })).toBeVisible();

    // Past 100px the header has switched to fixed and taken its 92px out of the
    // flow, which is the state the skip link has to land cleanly in.
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));

    // The skip link sits off-screen until it takes focus, so it is used the way a
    // keyboard user reaches it rather than clicked.
    await page.locator('a.skip').focus();
    const before = await page.evaluate(() => Math.round(window.scrollY));
    await page.keyboard.press('Enter');

    // The jump is smooth, so a single read can catch it mid-flight; wait for
    // scrollY to stop changing rather than trusting a fixed delay.
    let last = -1;
    let same = 0;
    for (let i = 0; i < 60; i += 1) {
      await page.waitForTimeout(120);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      if (y === last) {
        same += 1;
        if (same >= 5) break;
      } else {
        same = 0;
        last = y;
      }
    }

    const landed = await page.evaluate(() => {
      const target = document.querySelector('#apply-form')!;
      const header = document.getElementById('header-sticky')!;
      return {
        y: Math.round(window.scrollY),
        top: Math.round(target.getBoundingClientRect().top),
        headerHeight: header.offsetHeight,
        headerFixed: getComputedStyle(header).position === 'fixed',
        spacer: Math.round(
          Array.from(document.querySelectorAll<HTMLElement>('.site-header-spacer')).reduce(
            (t, el) => t + el.offsetHeight,
            0,
          ),
        ),
      };
    });

    expect(landed.headerFixed).toBe(true);
    expect(landed.y).toBeGreaterThan(before);
    // The spacer holds the 92px the fixed header took out of the flow and the
    // 104px scroll-padding aligns the form to it, so its top comes to rest just
    // under the header — neither behind it, which was the bug, nor stranded a
    // screenful below, which is what a jump that ignored the padding gives.
    expect(landed.spacer).toBeGreaterThanOrEqual(landed.headerHeight);
    expect(landed.top).toBeGreaterThanOrEqual(landed.headerHeight);
    expect(landed.top).toBeLessThanOrEqual(landed.headerHeight + 30);
  });
});

// The page keeps its own jump links in a rail below the site header, so the
// header turning fixed must not cover the section an anchor lands on.
test.describe('stem-contest section rail', () => {
  test.use({ viewport: WIDTHS[0] });

  test('rail links land their section below the header', async ({ page }) => {
    await page.goto('/service-details/stem-contest');
    const rail = page.locator('.section-rail');
    await expect(rail).toBeVisible();

    for (const label of ['Competition route', 'School enrollment', 'Partners', 'Opportunities']) {
      await rail.getByRole('link', { name: label }).click();
      const target = await page.evaluate(() => {
        const hash = window.location.hash.slice(1);
        const section = document.getElementById(hash);
        const header = document.getElementById('header-sticky');
        if (!section || !header) return null;
        return {
          headingTop: Math.round(section.getBoundingClientRect().top),
          headerBottom: Math.round(header.getBoundingClientRect().bottom),
        };
      });
      expect(target, `#${label} resolved to nothing`).not.toBeNull();
      expect(target!.headingTop).toBeGreaterThanOrEqual(target!.headerBottom - 2);
    }
  });
});

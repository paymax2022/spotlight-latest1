/**
 * The hamburger answers before the bundles do.
 *
 * Production serves the marketing pages from a LiteSpeed origin: the HTML is
 * streamed first and roughly nineteen chunk requests follow it, which used to
 * leave a window of thirteen seconds or more in which a click on the header did
 * nothing at all. To the visitor on a slow connection the menu simply read as
 * missing.
 *
 * These cases reproduce that connection by refusing every script, so what is
 * being tested is the server HTML plus the one inline script the header carries,
 * and nothing else.
 */

import { expect, test, type Page } from '@playwright/test';

/** Load a page with no JavaScript bundle able to run. */
async function gotoWithoutScripts(page: Page, path: string) {
  await page.route('**/*.js', (route) => route.abort());
  await page.goto(path);
}

test.describe('hamburger without hydration', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the marketing drawer opens and closes on class alone', async ({ page }) => {
    await gotoWithoutScripts(page, '/');
    const panel = page.locator('.sp-home .hdr-drawer__panel');
    await expect(panel).not.toHaveClass(/is-open/);

    await page.locator('.sp-home .menu-toggle').click();
    await expect(panel).toHaveClass(/is-open/);
    // The links have to be reachable, not merely painted: an inert panel is a
    // drawer the visitor can see and cannot use.
    await expect(panel).not.toHaveAttribute('inert', '');
    await expect(panel.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login');

    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/is-open/);
  });

  test('the template offcanvas opens on class alone', async ({ page }) => {
    await gotoWithoutScripts(page, '/about');
    const panel = page.locator('.offcanvas__info');
    await expect(panel).not.toHaveClass(/info-open/);

    await page.locator('.header__hamburger .sidebar__toggle').click();
    await expect(panel).toHaveClass(/info-open/);
    await expect(page.locator('.offcanvas__overlay')).toHaveClass(/overlay-open/);
    // The site menu is in the panel at this width, not only on a phone.
    await expect(panel.getByRole('link', { name: 'Season 2' })).toBeVisible();
  });
});

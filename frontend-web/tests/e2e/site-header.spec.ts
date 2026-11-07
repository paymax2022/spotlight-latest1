/**
 * Site header — the top-right hamburger is the only route to sign in / register
 * on the marketing pages, so it must be reachable at every width, on every
 * template, and after the header turns sticky.
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from './helpers/auth';

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1100, height: 900 },
  { width: 900, height: 900 },
];

test.describe('landing home header', () => {
  test.use({ viewport: WIDTHS[0] });

  for (const viewport of WIDTHS) {
    test(`shows the hamburger at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.sp-home .menu-toggle')).toBeVisible();
    });
  }

  test('hamburger panel links to sign in and register', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sp-home .menu-toggle').click();
    const panel = page.locator('.sp-home .mobile-nav');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    await expect(panel.getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/login?tab=signup',
    );
  });

  test('signed-in member gets account links instead of sign in', async ({ page, context, request }) => {
    await loginViaApi(context, request);
    await page.goto('/');
    await page.locator('.sp-home .menu-toggle').click();
    const panel = page.locator('.sp-home .mobile-nav');
    await expect(panel.getByRole('link', { name: /my dashboard/i })).toHaveAttribute(
      'href',
      '/user-dashboard',
    );
    await expect(panel.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(panel.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
  });

  test('hamburger stays usable after the page is scrolled', async ({ page }) => {
    await page.goto('/');
    await page.mouse.wheel(0, 600);
    await expect(page.locator('.sp-home .menu-toggle')).toBeVisible();
    await page.locator('.sp-home .menu-toggle').click();
    await expect(page.locator('.sp-home .mobile-nav')).toBeVisible();
  });
});

test.describe('season-2 header', () => {
  test.use({ viewport: WIDTHS[0] });

  for (const viewport of WIDTHS) {
    test(`shows the hamburger at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/season-2');
      await expect(page.locator('.sp-season2 .menu-toggle')).toBeVisible();
    });
  }

  test('hamburger panel links to sign in and register', async ({ page }) => {
    await page.goto('/season-2');
    await page.locator('.sp-season2 .menu-toggle').click();
    const panel = page.locator('.sp-season2 .mobile-nav');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    await expect(panel.getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/login?tab=signup',
    );
  });

  test('signed-in member gets account links instead of sign in', async ({ page, context, request }) => {
    await loginViaApi(context, request);
    await page.goto('/season-2');
    await page.locator('.sp-season2 .menu-toggle').click();
    const panel = page.locator('.sp-season2 .mobile-nav');
    await expect(panel.getByRole('link', { name: /my dashboard/i })).toHaveAttribute(
      'href',
      '/user-dashboard',
    );
    await expect(panel.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(panel.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
  });
});

test.describe('template header', () => {
  test.use({ viewport: WIDTHS[0] });

  for (const viewport of WIDTHS) {
    test(`shows the hamburger on /about at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/about');
      await expect(page.locator('.header__hamburger .sidebar__toggle')).toBeVisible();
    });
  }

  test('hamburger opens the panel with a sign in link', async ({ page }) => {
    await page.goto('/about');
    await page.locator('.header__hamburger .sidebar__toggle').click();
    const panel = page.locator('.offcanvas__info.info-open');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  test('hamburger is still visible once the header is sticky', async ({ page }) => {
    await page.goto('/about');
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

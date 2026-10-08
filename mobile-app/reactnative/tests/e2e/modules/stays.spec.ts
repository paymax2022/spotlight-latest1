import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Stays hub. EXPO_PUBLIC_STAYS_USE_MOCK defaults true, so home rails (recent
 * searches, deals, trending destinations) come from stays.mock.ts — Eko
 * Signature, Wuse Garden Resort, Lagos/Abuja/Ikeja. The /stays route is gated
 * on the 'stays' registry key, so the visibility answer is stubbed.
 */
test.describe('Stays E2E - discovery hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['stays']);
    await loginAs(page);
  });

  test('renders the hero, search panel and seeded rails', async ({ page }) => {
    await page.goto('/stays');

    await expect(page.getByText('Paymax Stays')).toBeVisible();
    await expect(page.getByText(/Find your/)).toBeVisible();
    await expect(page.getByText('Search stays')).toBeVisible();
    // Seeded home payload: recent searches + deals + trending destinations.
    await expect(page.getByText('Recent searches')).toBeVisible();
    await expect(page.getByText('Deals & offers')).toBeVisible();
    await expect(page.getByText('Trending destinations')).toBeVisible();
    // deal1's property (Eko Signature) renders in the deals rail.
    await expect(page.getByText('Eko Signature, Victoria Island').first()).toBeVisible();
    // Host entry point.
    await expect(page.getByText('List your property on Paymax')).toBeVisible();
  });

  test('search CTA opens results seeded with the mock catalog', async ({ page }) => {
    await page.goto('/stays');

    await page.getByText('Search stays').click();
    await expect(page).toHaveURL(/\/stays\/results\/list/);
    // An unfiltered mock search returns all ten MOCK_PROPERTIES. Exact match —
    // the hub's "210 stays" destination chip is a substring collision that
    // stays mounted (hidden) under the transition.
    await expect(page.getByText('10 stays', { exact: true })).toBeVisible();
    // Radisson is only in the results list — the hub's deals rail (Eko, Wuse)
    // stays mounted but hidden under the transition.
    await expect(page.getByText('Radisson Ikeja GRA')).toBeVisible();
  });
});

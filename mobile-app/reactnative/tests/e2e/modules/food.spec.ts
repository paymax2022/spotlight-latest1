import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Food & Delivery hub. EXPO_PUBLIC_FOOD_USE_MOCK defaults true — the
 * restaurant feed is served by the in-app mock (Mama Cass, Chicken Republic…).
 */
test.describe('Food E2E - discovery hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub hero and seeded restaurants', async ({ page }) => {
    await page.goto('/food');

    await expect(page.getByText('Food & Delivery')).toBeVisible();
    await expect(page.getByText('Order now')).toBeVisible();
    await expect(page.getByText('Mama Cass').first()).toBeVisible();
    await expect(page.getByText('Chicken Republic').first()).toBeVisible();
  });

  test('offers the sell-on-Paymax entry point', async ({ page }) => {
    await page.goto('/food');

    await expect(page.getByText('Sell food on Paymax')).toBeVisible();
  });
});

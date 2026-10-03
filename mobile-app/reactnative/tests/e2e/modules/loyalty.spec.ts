import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Loyalty (Rewards) hub. EXPO_PUBLIC_LOYALTY_USE_MOCK defaults true — the
 * account (6,200 pts balance, Silver tier, 11,550 pts to Gold) and the
 * catalog come from features/loyalty/api.ts, so no endpoint mocks are
 * needed beyond the ambient stubs.
 */
test.describe('Loyalty E2E - rewards hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the points balance, tier and featured rewards', async ({ page }) => {
    await page.goto('/loyalty');

    await expect(page.getByText('Rewards', { exact: true })).toBeVisible();
    await expect(page.getByText('Points balance')).toBeVisible();
    await expect(page.getByText('6,200 pts')).toBeVisible();
    await expect(page.getByText('Silver', { exact: true })).toBeVisible();
    await expect(page.getByText('11,550 pts to Gold')).toBeVisible();

    // Featured rail = first three MOCK_CATALOG items.
    await expect(page.getByText('Featured rewards')).toBeVisible();
    await expect(page.getByText('₦500 Airtime')).toBeVisible();
    await expect(page.getByText('₦1,000 Bill Credit')).toBeVisible();
  });

  test('shows the action row and refer-a-friend entry', async ({ page }) => {
    await page.goto('/loyalty');

    await expect(page.getByText('Points balance')).toBeVisible();
    await expect(page.getByText('Catalog', { exact: true })).toBeVisible();
    await expect(page.getByText('Earn history', { exact: true })).toBeVisible();
    await expect(page.getByText('Progress', { exact: true })).toBeVisible();
    await expect(page.getByText('Refer & earn points')).toBeVisible();
  });
});

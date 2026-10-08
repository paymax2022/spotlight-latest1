import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Marketplace hub. The feature ships a full in-app mock layer
 * (EXPO_PUBLIC_MARKETPLACE_USE_MOCK defaults true), so no endpoint mocks are
 * needed beyond the ambient stubs — categories and rails come from
 * discovery.mock.ts (iPhone 13 Pro Max, PlayStation 5, …).
 */
test.describe('Marketplace E2E - discovery hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with real categories and listing rails', async ({ page }) => {
    await page.goto('/marketplace');

    await expect(page.getByText('Marketplace')).toBeVisible();
    await expect(page.getByText('Phones & Tablets')).toBeVisible();
    await expect(page.getByText('Vehicles')).toBeVisible();
    await expect(page.getByText('Gaming')).toBeVisible();
    // Home rails are fed by mockHomeRails — a seeded listing must appear.
    await expect(page.getByText(/iPhone 13 Pro Max/).first()).toBeVisible();
  });

  test('tapping a category tile opens its category screen', async ({ page }) => {
    await page.goto('/marketplace');

    await page.getByText('Phones & Tablets').click();
    await expect(page).toHaveURL(/\/marketplace\/category\/cat_phones/);
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Savings hub. EXPO_PUBLIC_SAVINGS_USE_MOCK defaults true — summary, vaults,
 * ajo circles and targets all come from the in-app mock (Rainy Day, Office Ajo…).
 */
test.describe('Savings E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders total saved and the product sections', async ({ page }) => {
    await page.goto('/savings');

    await expect(page.getByText('Savings', { exact: true })).toBeVisible();
    await expect(page.getByText('Total saved')).toBeVisible();
    // Seeded mock products must be listed — a vault and an ajo circle.
    await expect(page.getByText('Rainy Day')).toBeVisible();
    await expect(page.getByText('Office Ajo')).toBeVisible();
  });
});

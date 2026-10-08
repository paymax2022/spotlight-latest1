import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Finance hub (estate collections dashboard). EXPO_PUBLIC_FINANCE_USE_MOCK
 * defaults true — the fixture in src/features/finance/api.ts seeds ₦420,000
 * collected this month (₦1,845,000 all-time), a category breakdown and three
 * recent payers, so no endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Finance E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the collections hero and headline stats', async ({ page }) => {
    await page.goto('/finance');

    await expect(page.getByText('Finance', { exact: true })).toBeVisible();
    await expect(page.getByText('Estate collections')).toBeVisible();
    await expect(page.getByText('Collected this month')).toBeVisible();
    // collectedThisMonthKobo = 42,000,000 kobo; collectedTotalKobo = 184,500,000.
    await expect(page.getByText('₦420,000.00')).toBeVisible();
    await expect(page.getByText('₦1,845,000.00 all-time')).toBeVisible();
    await expect(page.getByText('Outstanding')).toBeVisible();
    // collectionRate = 81.
    await expect(page.getByText('81%')).toBeVisible();
  });

  test('shows the category breakdown and recent payers', async ({ page }) => {
    await page.goto('/finance');

    await expect(page.getByText('Collected by category')).toBeVisible();
    await expect(page.getByText('Service Charge')).toBeVisible();
    await expect(page.getByText('Security Levy')).toBeVisible();

    await expect(page.getByText('Recent payments')).toBeVisible();
    await expect(page.getByText('Ngozi Okeke')).toBeVisible();
    await expect(page.getByText('Tunde Bello')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Estate Reports hub. EXPO_PUBLIC_REPORTS_USE_MOCK defaults true — the four
 * sections (Dues collection, Payments by method, Maintenance, Meetings) and
 * their metrics come from the seeded ReportsResponse in api.ts, so no
 * endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Reports E2E - estate analytics hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders all report sections with seeded metrics', async ({ page }) => {
    await page.goto('/reports');

    await expect(page.getByText('Reports', { exact: true })).toBeVisible();
    await expect(page.getByText('Estate analytics')).toBeVisible();
    await expect(page.getByText('Dues collection')).toBeVisible();
    await expect(page.getByText('Total billed')).toBeVisible();
    await expect(page.getByText('₦2,160,000')).toBeVisible();
    await expect(page.getByText('Collection rate')).toBeVisible();
    await expect(page.getByText('81%', { exact: true })).toBeVisible();
    await expect(page.getByText('Payments by method')).toBeVisible();
    await expect(page.getByText('Maintenance')).toBeVisible();
    await expect(page.getByText('Meetings')).toBeVisible();
  });
});

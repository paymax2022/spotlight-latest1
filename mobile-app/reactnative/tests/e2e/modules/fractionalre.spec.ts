import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Fractional real-estate hub. EXPO_PUBLIC_FRACTIONALRE_USE_MOCK defaults true;
 * the mock investor profile is active+KYC-verified (no onboarding redirect, no
 * KYC banner), the portfolio totals ₦20,640 and featured offerings come from
 * MOCK_OFFERINGS. The /fractionalre route is gated on 'realtor'.
 */
test.describe('FractionalRE E2E - investor hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['realtor']);
    await loginAs(page);
  });

  test('renders the portfolio hero and featured opportunities', async ({ page }) => {
    await page.goto('/fractionalre');

    await expect(page.getByText('Real Estate Invest')).toBeVisible();
    // MOCK_PORTFOLIO totals (totalValueKobo 2_064_000_00 → ₦2,064,000).
    await expect(page.getByText('Portfolio value')).toBeVisible();
    await expect(page.getByText('₦2,064,000')).toBeVisible();
    await expect(page.getByText('View portfolio')).toBeVisible();
    // Featured carousel from MOCK_OFFERINGS.
    await expect(page.getByText('Featured opportunities')).toBeVisible();
    await expect(page.getByText('Lekki Phase 1 Serviced Apartments').first()).toBeVisible();
    await expect(page.getByText('Ikoyi Grade-A Office Floor').first()).toBeVisible();
  });

  test('explore tile opens the offerings market', async ({ page }) => {
    await page.goto('/fractionalre');

    await page.getByText('Explore', { exact: true }).click();
    await expect(page).toHaveURL(/\/fractionalre\/market/);
    await expect(page.getByText('Opportunities', { exact: true })).toBeVisible();
  });
});

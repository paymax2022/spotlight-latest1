import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Dues & rent hub. EXPO_PUBLIC_DUES_USE_MOCK defaults true, so invoices come
 * from the in-memory fixtures in dues/api.ts: Waste (paid), Security Levy
 * (overdue ₦30,000) and Service Charge (pending ₦75,000) → ₦105,000.00
 * outstanding. The wallet is stubbed because the payment sheet reads the
 * balance when it opens (an unmocked 401 signs the user out).
 */
test.describe('Dues E2E - invoice hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders the outstanding balance and seeded invoices', async ({ page }) => {
    await page.goto('/dues');

    await expect(page.getByText('Dues & Rent')).toBeVisible();
    await expect(page.getByText('Outstanding balance')).toBeVisible();
    await expect(page.getByText('₦105,000.00')).toBeVisible();
    // Seeded invoice categories + status chips.
    await expect(page.getByText('Waste', { exact: true })).toBeVisible();
    await expect(page.getByText('Security Levy')).toBeVisible();
    await expect(page.getByText('Service Charge')).toBeVisible();
    await expect(page.getByText('Overdue')).toBeVisible();
    await expect(page.getByText('Paid')).toBeVisible();
    // The two unsettled invoices each carry a Pay action.
    await expect(page.getByText('Pay', { exact: true })).toHaveCount(2);
  });

  test('tapping Pay opens the wallet/card payment sheet', async ({ page }) => {
    await page.goto('/dues');

    await page.getByText('Pay', { exact: true }).first().click();
    // First payable row is the overdue Security Levy invoice. '₦30,000.00'
    // renders twice (list row + sheet amount), so assert the rail options and
    // the sheet-only funded-balance hint instead.
    await expect(page.getByText('Pay with wallet')).toBeVisible();
    await expect(page.getByText('Pay with Card / Transfer')).toBeVisible();
    await expect(page.getByText('Balance: ₦150,000.00')).toBeVisible();
  });
});

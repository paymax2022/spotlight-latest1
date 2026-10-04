import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate vendors hub. EXPO_PUBLIC_VENDORS_USE_MOCK defaults true, so the
 * directory (Chukwu Plumbing Works, BrightSpark Electricals, …) and job list
 * come from the in-memory fixtures in vendors/api.ts — no endpoint stubs
 * needed, and /vendors has no registry gate.
 */
test.describe('Vendors E2E - directory hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('directory tab lists the seeded artisans', async ({ page }) => {
    await page.goto('/vendors');

    await expect(page.getByText('Vendors', { exact: true })).toBeVisible();
    await expect(page.getByText('Directory')).toBeVisible();
    await expect(page.getByText('Jobs')).toBeVisible();
    // Seeded vendors, rating-sorted (BrightSpark 4.8 first).
    await expect(page.getByText('BrightSpark Electricals')).toBeVisible();
    await expect(page.getByText('Chukwu Plumbing Works')).toBeVisible();
    await expect(page.getByText('GreenScape Landscaping')).toBeVisible();
    await expect(page.getByText('Verified').first()).toBeVisible();
  });

  test('jobs tab shows the seeded vendor jobs', async ({ page }) => {
    await page.goto('/vendors');

    await page.getByText('Jobs').click();
    // j1 in progress (₦45,000.00), j2 completed (₦12,000.00).
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Completed')).toBeVisible();
    await expect(page.getByText('₦45,000.00')).toBeVisible();
    await expect(page.getByText('₦12,000.00')).toBeVisible();
  });
});

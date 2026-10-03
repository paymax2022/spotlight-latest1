import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate Repairs / Maintenance hub. EXPO_PUBLIC_REPAIRS_USE_MOCK defaults true,
 * so the request list comes from repairs/api.ts fixtures (generator +
 * pothole tickets on est_amber_court).
 */
test.describe('Repairs E2E - maintenance hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the seeded repair requests with status and urgency', async ({ page }) => {
    await page.goto('/repairs');

    await expect(page.getByText('Maintenance', { exact: true })).toBeVisible();
    // Seeded tickets: generator (in progress, high) and road (reported, medium).
    await expect(page.getByText('Generator', { exact: true })).toBeVisible();
    await expect(page.getByText('Estate generator tripping every evening at peak load.')).toBeVisible();
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('High', { exact: true })).toBeVisible();
    await expect(page.getByText('Ngozi Okeke')).toBeVisible();
    await expect(page.getByText('Road', { exact: true })).toBeVisible();
    await expect(page.getByText('Pothole near Gate B is widening after the rains.')).toBeVisible();
    await expect(page.getByText('Reported')).toBeVisible();
  });

  test('tapping a request opens its detail with cost and activity timeline', async ({ page }) => {
    await page.goto('/repairs');

    await page.getByText('Estate generator tripping every evening at peak load.').click();
    await expect(page).toHaveURL(/\/repairs\/r1/);
    // The list stays mounted-but-hidden — assert detail-only content.
    await expect(page.getByText('Estimated cost')).toBeVisible();
    await expect(page.getByText('₦45,000.00')).toBeVisible();
    await expect(page.getByText('Activity')).toBeVisible();
    await expect(page.getByText('Awaiting replacement AVR part.')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate Facilities hub. EXPO_PUBLIC_FACILITIES_USE_MOCK defaults true, so
 * amenities (Amber Clubhouse, Estate Pool, …) and the seeded confirmed booking
 * come from facilities/api.ts fixtures.
 */
test.describe('Facilities E2E - amenities hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the seeded amenities on the browse tab', async ({ page }) => {
    await page.goto('/facilities');

    // exact — 'Loading facilities…' is a substring collision while the query runs.
    await expect(page.getByText('Facilities', { exact: true })).toBeVisible();
    await expect(page.getByText('Browse', { exact: true })).toBeVisible();
    await expect(page.getByText('My bookings')).toBeVisible();
    // Seeded facilities.
    await expect(page.getByText('Amber Clubhouse')).toBeVisible();
    await expect(page.getByText('Event Hall')).toBeVisible();
    await expect(page.getByText('Estate Pool')).toBeVisible();
    await expect(page.getByText('Tennis Court')).toBeVisible();
    await expect(page.getByText('Fitness Gym')).toBeVisible();
    // Pool and gym are free; the clubhouse carries a fee.
    await expect(page.getByText('Free', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('₦50,000.00')).toBeVisible();
  });

  test('the bookings tab shows the seeded confirmed reservation', async ({ page }) => {
    await page.goto('/facilities');

    await page.getByRole('tab', { name: 'My bookings' }).click();

    await expect(page.getByText('Amber Clubhouse')).toBeVisible();
    await expect(page.getByText('Confirmed')).toBeVisible();
    await expect(page.getByText('₦50,000.00')).toBeVisible();
  });
});

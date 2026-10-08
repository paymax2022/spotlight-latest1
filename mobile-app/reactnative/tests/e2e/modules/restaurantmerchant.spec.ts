import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Restaurant merchant order queue (/food/restaurant). Two flags intersect
 * here: the order list comes from the FOOD feature (EXPO_PUBLIC_FOOD_USE_MOCK
 * defaults true → the seeded 'Chicken Republic' Refuel Meal order), while
 * useMyStores is restaurantmerchant (EXPO_PUBLIC_RESTAURANT_MERCHANT_USE_MOCK
 * defaults FALSE) and must be route-mocked. /food/* is gated on 'restaurant'.
 */
test.describe('Restaurant merchant E2E - order queue', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['restaurant']);
    await page.route('**/api/finance/restaurant/mine**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'r-demo',
              owner_id: 'usr_self',
              name: 'My Kitchen',
              description: '',
              address: '1 Demo Street, Lagos',
              is_open: true,
              created_at: '2026-06-14T00:00:00.000Z',
            },
          ],
        }),
      });
    });
    await loginAs(page);
  });

  test('renders the queue with the seeded completed order and tab bar', async ({ page }) => {
    await page.goto('/food/restaurant');

    await expect(page.getByText('Restaurant · Orders')).toBeVisible();
    // The mock seeds only a delivered order, so the active lane is empty.
    await expect(page.getByText('Active (0)')).toBeVisible();
    await expect(page.getByText('No active orders.')).toBeVisible();
    // Completed lane: seeded order for r2 (Chicken Republic), Refuel Meal.
    await expect(page.getByText('Completed')).toBeVisible();
    await expect(page.getByText('Chicken Republic')).toBeVisible();
    await expect(page.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(page.getByText('1 item · 12 Bourdillon Road, Ikoyi')).toBeVisible();
    // Bottom merchant navigation.
    await expect(page.getByText('Earnings', { exact: true })).toBeVisible();
    await expect(page.getByText('Manage', { exact: true })).toBeVisible();
  });

  test('tapping an order opens the manage-order detail', async ({ page }) => {
    await page.goto('/food/restaurant');

    await page.getByText('Chicken Republic').click();
    await expect(page).toHaveURL(/\/food\/restaurant\/order\//);
    // The queue stays mounted-but-hidden — assert text unique to the detail.
    await expect(page.getByText('Manage order')).toBeVisible();
    await expect(page.getByText('Refuel Meal')).toBeVisible();
  });
});

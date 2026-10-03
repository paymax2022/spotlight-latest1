import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Announcements hub (estate notices). The feature ships an in-app mock layer
 * (EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK defaults true), so the feed renders with
 * no endpoint mocks — items come from the seeded list in
 * src/features/announcements/api.ts.
 */
test.describe('Announcements E2E - estate feed', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with seeded announcements', async ({ page }) => {
    await page.goto('/announcements');

    await expect(page.getByText('Announcements', { exact: true })).toBeVisible();
    await expect(page.getByText('Water supply maintenance Saturday')).toBeVisible();
    await expect(page.getByText('Q3 service charge due 30th')).toBeVisible();
    await expect(page.getByText('Increased patrols this week')).toBeVisible();
  });

  test('tapping an announcement opens its detail screen', async ({ page }) => {
    await page.goto('/announcements');

    await page.getByText('Water supply maintenance Saturday').click();
    await expect(page).toHaveURL(/\/announcements\/a1/);
    // The hidden list screen stays mounted under the pushed detail screen, so
    // assert the detail-only byline rather than the duplicated body text.
    await expect(page.getByText(/Estate Office ·/)).toBeVisible();
  });
});

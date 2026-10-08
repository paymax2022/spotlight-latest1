import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Meetings hub (estate meetings). The feature ships an in-app mock layer
 * (EXPO_PUBLIC_MEETINGS_USE_MOCK defaults true), so the list renders with no
 * endpoint mocks — items come from seedMeetings in meetings.mock.ts
 * (Q3 General Meeting, Security Committee Sync, 2026 Budget Review).
 */
test.describe('Meetings E2E - meetings hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with seeded upcoming meetings', async ({ page }) => {
    await page.goto('/meetings');

    await expect(page.getByText('Meetings', { exact: true })).toBeVisible();
    // Both seeded meetings start in the future, so they land on Upcoming.
    await expect(page.getByText('Security Committee Sync')).toBeVisible();
    await expect(page.getByText('Q3 General Meeting')).toBeVisible();
  });

  test('past tab shows the ended budget meeting', async ({ page }) => {
    await page.goto('/meetings');

    await page.getByText('Past', { exact: true }).click();
    await expect(page.getByText('2026 Budget Review')).toBeVisible();
    await expect(page.getByText('Security Committee Sync')).not.toBeVisible();
  });

  test('schedule button opens the create screen', async ({ page }) => {
    await page.goto('/meetings');

    await page.getByLabel('Schedule meeting').click();
    await expect(page).toHaveURL(/\/meetings\/create/);
    // Header + submit button both read "Schedule meeting" on the form.
    await expect(page.getByText('Schedule meeting').first()).toBeVisible();
  });
});

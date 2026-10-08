import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate member settings (notification preferences).
 * EXPO_PUBLIC_ESTATESETTINGS_USE_MOCK defaults true, so toggles render from
 * DEFAULT_SETTINGS (everything on) and mutations stay in memory.
 */
test.describe('Estate settings E2E - notification preferences', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the channel toggles and notification categories', async ({ page }) => {
    await page.goto('/estate-settings');

    // exact — 'Loading settings…' is a substring collision while the query runs.
    await expect(page.getByText('Settings', { exact: true })).toBeVisible();
    // Channels section.
    await expect(page.getByText('Channels')).toBeVisible();
    await expect(page.getByText('Push notifications')).toBeVisible();
    await expect(page.getByText('Email notifications')).toBeVisible();
    // Category section.
    await expect(page.getByText('Notify me about')).toBeVisible();
    await expect(page.getByText('Payments & dues')).toBeVisible();
    await expect(page.getByText('Meetings', { exact: true })).toBeVisible();
    await expect(page.getByText('Elections')).toBeVisible();
    await expect(page.getByText('Maintenance', { exact: true })).toBeVisible();
    await expect(page.getByText('Turn off both Push and Email to pause all estate notifications.')).toBeVisible();
  });
});

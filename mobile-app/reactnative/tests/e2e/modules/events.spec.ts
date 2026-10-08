import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Events discovery. EXPO_PUBLIC_EVENT_USE_MOCK defaults true — the seeded
 * mock events include 'Felabration 2026' (LIVE) and 'Lagos Tech Summit'.
 */
test.describe('Events E2E - discovery', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('lists seeded events and the organiser entry point', async ({ page }) => {
    await page.goto('/events');

    await expect(page.getByText('Events', { exact: true })).toBeVisible();
    await expect(page.getByText('Felabration 2026')).toBeVisible();
    await expect(page.getByText('Organising an event? Open dashboard')).toBeVisible();
  });
});

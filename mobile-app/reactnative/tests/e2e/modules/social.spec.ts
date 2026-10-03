import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Social Pay hub. EXPO_PUBLIC_SOCIAL_USE_MOCK defaults true — the profile and
 * activity feed come from the in-app mock (@you + seeded contacts).
 */
test.describe('Social Pay E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with the cashtag identity card', async ({ page }) => {
    await page.goto('/social');

    await expect(page.getByText('Social Pay')).toBeVisible();
    await expect(page.getByText('@you')).toBeVisible();
  });
});

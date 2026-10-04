import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Voting hub. This module is LIVE-by-default (EXPO_PUBLIC_VOTING_USE_MOCK is
 * `false` when unset — invented contests are worse than an empty list), so the
 * contests endpoint is stubbed here rather than relying on a mock layer.
 */
async function mockContests(page: Parameters<typeof loginAs>[0], body: unknown = []) {
  await page.route('**/api/v1/connect/contests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: body }),
    });
  });
}

test.describe('Voting E2E - contests hub', () => {
  test('signed-in user sees the hub and the enter-a-contest CTA', async ({ page }) => {
    await mockAmbientRequests(page);
    await mockContests(page);
    await loginAs(page);

    await page.goto('/voting');

    await expect(page.getByText('Spotlight Contest')).toBeVisible();
    await expect(page.getByText('Register / Apply to Compete')).toBeVisible();
  });

  test('empty live catalog shows an honest empty state, not invented contests', async ({ page }) => {
    await mockAmbientRequests(page);
    await mockContests(page, []);
    await loginAs(page);

    await page.goto('/voting');

    await expect(page.getByText('No active contests right now.')).toBeVisible();
  });
});

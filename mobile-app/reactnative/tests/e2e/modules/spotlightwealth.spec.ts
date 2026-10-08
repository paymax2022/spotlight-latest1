import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Spotlight Wealth hub. EXPO_PUBLIC_SPOTLIGHT_USE_MOCK defaults true —
 * videos, challenges, leaderboard and campaigns all come from
 * spotlight.mock.ts (Ada Talks Money, 7-Day Money Habits, Chidinma O., …),
 * so no endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Spotlight Wealth E2E - learning hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders the hub with videos, challenges, leaderboard and campaigns', async ({ page }) => {
    await page.goto('/spotlight-wealth');

    await expect(page.getByText('Spotlight Wealth', { exact: true })).toBeVisible();
    await expect(page.getByText('Learn. Earn credit. Grow your money knowledge.')).toBeVisible();
    await expect(page.getByText('Creator finance videos')).toBeVisible();
    await expect(page.getByText('How to build your first budget on any income')).toBeVisible();
    await expect(page.getByText('Active challenges')).toBeVisible();
    await expect(page.getByText('7-Day Money Habits')).toBeVisible();
    await expect(page.getByText('Learning leaderboard').first()).toBeVisible();
    await expect(page.getByText('Chidinma O.', { exact: true })).toBeVisible();
    await expect(page.getByText('Campaigns')).toBeVisible();
  });

  test('See all on the videos rail opens the video library', async ({ page }) => {
    await page.goto('/spotlight-wealth');

    await expect(page.getByText('Creator finance videos')).toBeVisible();
    // Two rails carry "See all"; the first belongs to Creator finance videos.
    await page.getByText('See all').first().click();
    await expect(page).toHaveURL(/\/spotlight-wealth\/videos/);
    // Exact — the hub's 'Creator finance videos' rail stays mounted underneath.
    await expect(page.getByText('Finance videos', { exact: true })).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Referral (Earn) hub. app/referral/index.tsx redirects to the Home tab at
 * /referral/(tabs)/home — asserted here. EXPO_PUBLIC_REFERRAL_USE_MOCK
 * defaults true, so the dashboard snapshot (₦1,500 eligible / ₦5,000
 * lifetime, 14 invites, rank #23) and the activity feed come from
 * features/referral/home/api.ts — no endpoint mocks needed.
 */
test.describe('Referral E2E - Earn hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('lands on the Earn hub with the seeded earnings snapshot', async ({ page }) => {
    await page.goto('/referral');

    await expect(page).toHaveURL(/\/referral\//);
    await expect(page.getByText('Earn hub', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready to withdraw')).toBeVisible();
    await expect(page.getByText('₦1,500', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Lifetime earned ₦5,000')).toBeVisible();

    // Invite funnel + leaderboard rank from MOCK_SUMMARY.
    await expect(page.getByText('Invited', { exact: true })).toBeVisible();
    await expect(page.getByText('#23')).toBeVisible();
    await expect(page.getByText('Rising', { exact: true })).toBeVisible();
  });

  test('shows quick-share entry points and recent activity', async ({ page }) => {
    await page.goto('/referral');

    await expect(page.getByText('Earn hub', { exact: true })).toBeVisible();
    await expect(page.getByText('Invite friends')).toBeVisible();
    await expect(page.getByText('My code, link & QR')).toBeVisible();

    // Recent activity preview — first rows of MOCK_ACTIVITY.
    await expect(page.getByText('Recent activity')).toBeVisible();
    await expect(page.getByText('Amara completed KYC')).toBeVisible();
    await expect(page.getByText('Tunde created an account')).toBeVisible();
  });
});

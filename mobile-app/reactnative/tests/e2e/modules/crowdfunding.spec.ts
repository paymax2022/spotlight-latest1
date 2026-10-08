import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Crowdfunding hub. EXPO_PUBLIC_CF_USE_MOCK defaults true — categories come
 * from CAMPAIGN_CATEGORIES and every rail (featured / urgent / trending /
 * all-active) is seeded from crowdfunding.mock.ts (Baby Zara, Ajegunle
 * solar, Àdìre documentary…), so no endpoint mocks are needed beyond the
 * ambient stubs. RemoteBanner uses skipAuthRedirect, so its slug lookup
 * cannot bounce the session.
 */
test.describe('Crowdfunding E2E - discovery hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with categories and seeded campaign rails', async ({ page }) => {
    await page.goto('/crowdfunding');

    await expect(page.getByText('Crowdfunding', { exact: true })).toBeVisible();
    await expect(page.getByText('Browse by cause')).toBeVisible();
    await expect(page.getByText('Medical', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Emergency', { exact: true }).first()).toBeVisible();

    // cf1 is featured + urgent + trending — it shows up in several rails.
    await expect(page.getByText('Featured', { exact: true })).toBeVisible();
    await expect(page.getByText('Help Baby Zara Get Open-Heart Surgery').first()).toBeVisible();
    await expect(page.getByText('All active campaigns')).toBeVisible();
    await expect(page.getByText('Start a campaign')).toBeVisible();
  });

  test('tapping a campaign card opens its detail screen', async ({ page }) => {
    await page.goto('/crowdfunding');

    await expect(page.getByText('All active campaigns')).toBeVisible();
    await page.getByText('Help Baby Zara Get Open-Heart Surgery').first().click();
    await expect(page).toHaveURL(/\/crowdfunding\/campaign\/cf1/);
  });
});

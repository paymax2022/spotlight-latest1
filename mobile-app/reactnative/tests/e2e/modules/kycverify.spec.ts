import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * KYC Verify hub (K1 — tier overview / step-up entry). This module is
 * LIVE-by-default (EXPO_PUBLIC_KYC_VERIFY_USE_MOCK is `false` when unset —
 * the real multi-provider gateway must fail visibly), so GET
 * /api/finance/kyc/me is stubbed per test with the tier under test.
 */
async function mockKycProfile(page: Page, tier: number) {
  await page.route('**/api/finance/kyc/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          kyc_tier: tier,
          kyc_status: tier > 0 ? 'verified' : 'unverified',
          requested_tier: null,
          phone_verified: tier > 0,
          kyc_submitted_at: null,
          kyc_verified_at: tier > 0 ? '2026-06-01T00:00:00.000Z' : null,
        },
      }),
    });
  });
}

test.describe('KYC Verify E2E - tier overview', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
  });

  test('a tier 1 user sees their limits and the upgrade CTA', async ({ page }) => {
    await mockKycProfile(page, 1);
    await loginAs(page);

    await page.goto('/kyc-verify');

    await expect(page.getByText('Verification', { exact: true })).toBeVisible();
    await expect(page.getByText('Tier 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Your current verification level')).toBeVisible();
    // TIER_LIMITS[1].
    await expect(page.getByText('₦50,000')).toBeVisible();
    await expect(page.getByText('₦300,000 max balance')).toBeVisible();
    await expect(page.getByText('Unlock Tier 2')).toBeVisible();
    await expect(page.getByText('Upgrade to unlock higher limits')).toBeVisible();
  });

  test('a tier 3 user sees the fully-verified state and no upgrade CTA', async ({ page }) => {
    await mockKycProfile(page, 3);
    await loginAs(page);

    await page.goto('/kyc-verify');

    await expect(page.getByText('Tier 3', { exact: true })).toBeVisible();
    await expect(page.getByText("You're fully verified")).toBeVisible();
    await expect(page.getByText('Unlimited balance')).toBeVisible();
    await expect(page.getByText('Upgrade to unlock higher limits')).toHaveCount(0);
  });

  test('the upgrade CTA opens the requirements checklist for the next tier', async ({ page }) => {
    await mockKycProfile(page, 1);
    await loginAs(page);

    await page.goto('/kyc-verify');

    await page.getByText('Upgrade to unlock higher limits').click();
    await expect(page).toHaveURL(/\/kyc-verify\/requirements/);
    // Unique to the requirements screen (the overview stays mounted-but-hidden).
    await expect(page.getByText(/To reach Tier 2/)).toBeVisible();
    await expect(page.getByText('A quick selfie')).toBeVisible();
  });
});

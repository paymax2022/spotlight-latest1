import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Invest onboarding intro. EXPO_PUBLIC_ONBOARDING_USE_MOCK defaults true —
 * the intro screen is static (ONBOARDING_INTRO_STEPS / TRUST_MARKERS /
 * RISK_DISCLOSURE_SHORT) and the eligibility check is served from
 * buildEligibility() in onboarding.mock.ts (eligible, Nigeria).
 */
test.describe('Invest Onboarding E2E - intro', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the intro with steps, trust markers and disclosure', async ({ page }) => {
    await page.goto('/invest-onboarding');

    await expect(page.getByText('Paymax Invest')).toBeVisible();
    await expect(page.getByText('Learn. Fund. Invest. Grow.')).toBeVisible();
    await expect(page.getByText('1. Learn')).toBeVisible();
    await expect(page.getByText('4. Grow')).toBeVisible();
    await expect(page.getByText('Bank-grade encryption')).toBeVisible();
    await expect(page.getByText('Regulated KYC & compliance')).toBeVisible();
    await expect(page.getByText(/Investing carries risk/)).toBeVisible();
    await expect(page.getByText('Get started')).toBeVisible();
  });

  test('Get started runs the region eligibility check', async ({ page }) => {
    await page.goto('/invest-onboarding');

    await page.getByText('Get started').click();
    await expect(page).toHaveURL(/\/invest-onboarding\/eligibility/);
    // Unique to the eligibility screen (the intro stays mounted-but-hidden).
    await expect(page.getByText("You're eligible")).toBeVisible();
    await expect(page.getByText('Paymax Invest is available in your region.')).toBeVisible();
    await expect(page.getByText('Continue to verification')).toBeVisible();
  });
});

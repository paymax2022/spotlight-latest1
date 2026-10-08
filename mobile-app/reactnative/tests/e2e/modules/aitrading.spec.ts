import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * AI Trading hub. EXPO_PUBLIC_TRADING_USE_MOCK defaults true — the mock starts
 * the user at KYC status NOT_STARTED, so the hub renders the risk-first
 * landing (not the portfolio dashboard) and the strategies screen is seeded
 * from MOCK_STRATEGIES in src/features/aitrading/api.ts.
 */
test.describe('AI Trading E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the risk-first landing for an unverified user', async ({ page }) => {
    await page.goto('/ai-trading');

    await expect(page.getByText('AI Trading', { exact: true })).toBeVisible();
    await expect(page.getByText('Autonomous AI portfolio management')).toBeVisible();
    // Non-dismissible risk framing + the gate CTA.
    await expect(page.getByText('You can lose money')).toBeVisible();
    await expect(page.getByText('How it works', { exact: true })).toBeVisible();
    await expect(page.getByText('Get started')).toBeVisible();
  });

  test('Get started opens the separate trading verification screen', async ({ page }) => {
    await page.goto('/ai-trading');

    await page.getByText('Get started').click();
    await expect(page).toHaveURL(/\/ai-trading\/kyc/);
    // Unique to the KYC screen (the landing stays mounted-but-hidden).
    await expect(page.getByText('Trading Verification')).toBeVisible();
    await expect(page.getByText('A separate check for trading')).toBeVisible();
  });

  test('the fund-management link opens the seeded strategies screen', async ({ page }) => {
    await page.goto('/ai-trading');

    await page.getByText('How your fund is managed').click();
    await expect(page).toHaveURL(/\/ai-trading\/strategies/);
    // Seeded from MOCK_STRATEGIES (strategyId rendered with spaces).
    await expect(page.getByText('trend following btc')).toBeVisible();
    await expect(page.getByText('mean reversion eth')).toBeVisible();
  });
});

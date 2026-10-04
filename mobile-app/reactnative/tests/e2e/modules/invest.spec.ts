import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Invest hub. EXPO_PUBLIC_INVEST_USE_MOCK defaults true — eligibility,
 * portfolio, wallet, market status and the trending list all come from
 * invest.mock.ts (Dangote Cement, MTN, GTCO, ₦245,000 portfolio…), so no
 * endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Invest E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with portfolio value and trending stocks', async ({ page }) => {
    await page.goto('/invest');

    await expect(page.getByText('Invest', { exact: true })).toBeVisible();
    await expect(page.getByText('Total portfolio value')).toBeVisible();
    // MOCK_PORTFOLIO.total_value_kobo = ₦245,000.
    await expect(page.getByText('₦245,000.00').first()).toBeVisible();
    // Trending rail is seeded from MOCK_STOCKS.
    await expect(page.getByText('Trending stocks')).toBeVisible();
    await expect(page.getByText('Dangote Cement Plc')).toBeVisible();
    await expect(page.getByText('MTNN')).toBeVisible();
  });

  test('shows the entry points and the education card', async ({ page }) => {
    await page.goto('/invest');

    await expect(page.getByText('Discover', { exact: true })).toBeVisible();
    await expect(page.getByText('Portfolio', { exact: true })).toBeVisible();
    await expect(page.getByText('Orders', { exact: true })).toBeVisible();
    await expect(page.getByText('New to investing?')).toBeVisible();
  });

  test('tapping a trending stock opens its detail screen', async ({ page }) => {
    await page.goto('/invest');

    await page.getByText('Dangote Cement Plc').click();
    await expect(page).toHaveURL(/\/invest\/stock\/DANGCEM/);
  });
});

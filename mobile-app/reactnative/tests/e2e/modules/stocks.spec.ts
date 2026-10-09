import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Stocks hub. EXPO_PUBLIC_STOCKS_USE_MOCK defaults true — assets, positions
 * and the market list come from stocks.mock.ts (Dangote Cement, Aradel,
 * Apple…), so no endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Stocks E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hero, holdings and market movers', async ({ page }) => {
    await page.goto('/stocks');

    await expect(page.getByText('Stocks', { exact: true })).toBeVisible();
    await expect(page.getByText('Invest in shares & ETFs')).toBeVisible();
    await expect(page.getByText('Stock holdings value')).toBeVisible();

    // MOCK_POSITIONS seeds DANGCEM, GTCO and AAPL holdings.
    await expect(page.getByText('Your holdings')).toBeVisible();
    await expect(page.getByText('Dangote Cement Plc').first()).toBeVisible();
    await expect(page.getByText('Apple Inc.')).toBeVisible();

    // Top movers are the active assets with the biggest day move — ARADEL (+4.28%).
    await expect(page.getByText('Markets', { exact: true })).toBeVisible();
    await expect(page.getByText('Aradel Holdings Plc')).toBeVisible();
  });

  test('shows the quick actions and public-offers entry', async ({ page }) => {
    await page.goto('/stocks');

    await expect(page.getByText('Stock holdings value')).toBeVisible();
    await expect(page.getByText('Buy', { exact: true })).toBeVisible();
    await expect(page.getByText('Sell', { exact: true })).toBeVisible();
    await expect(page.getByText('Available to invest')).toBeVisible();
    await expect(page.getByText('Public offers')).toBeVisible();
  });

  test('tapping a holding opens the asset detail screen', async ({ page }) => {
    await page.goto('/stocks');

    await expect(page.getByText('Your holdings')).toBeVisible();
    await page.getByText('Apple Inc.').click();
    await expect(page).toHaveURL(/\/stocks\/asset\/AAPL/);
  });
});

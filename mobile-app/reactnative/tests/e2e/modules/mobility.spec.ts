import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Mobility hub. EXPO_PUBLIC_MOBILITY_USE_MOCK defaults true, so the home
 * payload (quick tiles, safety reminder, no active trip) and trip history come
 * from mobility.mock.ts — only the wallet balance behind the BalanceCard and
 * the module-visibility registry ('transport' gates the /mobility route) need
 * stubs.
 */
test.describe('Mobility E2E - rider hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['transport']);
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders the hub with the trip planner, mode tiles and safety reminder', async ({ page }) => {
    await page.goto('/mobility');

    await expect(page.getByText('Mobility', { exact: true })).toBeVisible();
    // Trip planner placeholders.
    await expect(page.getByText('Set your pickup point')).toBeVisible();
    await expect(page.getByText('Where to?')).toBeVisible();
    // Seeded quick tiles (MOCK_QUICK_TILES → ride/schedule/parcel/airport).
    await expect(page.getByText('Ride now')).toBeVisible();
    await expect(page.getByText('Airport')).toBeVisible();
    // "More ways to move" mode tiles.
    await expect(page.getByText('More ways to move')).toBeVisible();
    await expect(page.getByText('Book a bus')).toBeVisible();
    await expect(page.getByText('Car hire')).toBeVisible();
    // Mock safety reminder + driver-mode banner.
    await expect(page.getByText(/confirm the plate number and your trip PIN/)).toBeVisible();
    await expect(page.getByText('Drive with Paymax')).toBeVisible();
  });

  test('trip history entry opens the seeded past-rides list', async ({ page }) => {
    await page.goto('/mobility');

    await page.getByText('Trip history').click();
    await expect(page).toHaveURL(/\/mobility\/history/);
    // MOCK_HISTORY renders completed/cancelled trips with Rebook actions.
    // Exact match — the hub's "Rebook a past ride in one tap" subtitle is a
    // substring collision that stays mounted (hidden) under the transition.
    await expect(page.getByText('Rebook', { exact: true }).first()).toBeVisible();
  });
});

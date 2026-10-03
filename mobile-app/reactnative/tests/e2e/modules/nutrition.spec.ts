import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Nutrition (vendor review surfaces). There is no /nutrition index route —
 * the entry points are the menu review (/nutrition/menu/[menuId]) and the
 * per-dish review (/nutrition/[dishId]). EXPO_PUBLIC_NUTRITION_USE_MOCK
 * defaults true; mock.ts seeds menu 'm1' with three dishes — i1 (AI
 * estimate), i4 (packaged label, EXACT), i5 (restaurant-confirmed).
 */
test.describe('Nutrition E2E - vendor review', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('menu review lists the seeded menu with pending estimates', async ({ page }) => {
    await page.goto('/nutrition/menu/m1');

    await expect(page.getByText('Review your nutrition')).toBeVisible();
    await expect(page.getByText(/already estimated and published nutrition/)).toBeVisible();
    // Only i1 is still an AI estimate → singular copy + Approve all (1).
    await expect(page.getByText('1 dish still showing as an AI estimate.')).toBeVisible();
    await expect(page.getByText('Approve all (1)')).toBeVisible();
    await expect(page.getByText('Confirmed').first()).toBeVisible();
  });

  test('dish review shows the AI estimate and the allergen step', async ({ page }) => {
    await page.goto('/nutrition/i1');

    await expect(page.getByText('Review nutrition')).toBeVisible();
    await expect(page.getByText(/already live for buyers/)).toBeVisible();
    await expect(page.getByText('Allergens (required, separate step)')).toBeVisible();
    await expect(page.getByText('Approve estimate')).toBeVisible();
  });
});

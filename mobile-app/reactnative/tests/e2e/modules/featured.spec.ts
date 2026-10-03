import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Featured Placement. There is no /featured index route — the hub is
 * /featured/promotions ("My promotions"), the surface the home screen's
 * featured entry point links to. EXPO_PUBLIC_FEATURED_USE_MOCK defaults true
 * and mock.ts seeds one ACTIVE campaign (Mama Cass — Jollof Combo on the
 * Home Featured Carousel zone), so no endpoint mocks are needed.
 */
test.describe('Featured E2E - promotions hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders My promotions with the seeded active campaign', async ({ page }) => {
    await page.goto('/featured/promotions');

    await expect(page.getByText('My promotions')).toBeVisible();
    await expect(page.getByText('Mama Cass — Jollof Combo')).toBeVisible();
    await expect(page.getByText('Home Featured Carousel')).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });

  test('new-promotion button opens the Promote wizard', async ({ page }) => {
    await page.goto('/featured/promotions');

    await expect(page.getByText('My promotions')).toBeVisible();
    await page.getByLabel('New promotion').click();
    await expect(page).toHaveURL(/\/featured\/new/);
    await expect(page.getByText('Featured Placement')).toBeVisible();
  });
});

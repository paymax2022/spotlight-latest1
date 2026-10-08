import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Creators discover hub. EXPO_PUBLIC_CREATORS_USE_MOCK defaults true and the
 * directory read has no backend endpoint at all (api.ts comment: discovery
 * always falls back to MOCK_CREATORS) — Tope Beats, Lara Cooks, Zedd Plays,
 * Amaka Speaks, Dare Comedy. The /creators route IS registry-gated on the
 * 'creators' key (routeModuleKeys.ts), so the visibility answer is stubbed.
 */
test.describe('Creators E2E - discover hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await mockModuleVisibility(page, ['creators']);
    await loginAs(page);
  });

  test('renders the discover hub with quick links and seeded creators', async ({ page }) => {
    await page.goto('/creators');

    await expect(page.getByText('Creators', { exact: true })).toBeVisible();
    await expect(page.getByText('Become a creator')).toBeVisible();
    await expect(page.getByText('My subscriptions')).toBeVisible();
    await expect(page.getByText('Earnings')).toBeVisible();
    await expect(page.getByText('Discover creators')).toBeVisible();
    // Seeded mock directory.
    await expect(page.getByText('Tope Beats')).toBeVisible();
    await expect(page.getByText('Lara Cooks')).toBeVisible();
    await expect(page.getByText('@laracooks · Food')).toBeVisible();
  });

  test('tapping a creator card opens their storefront', async ({ page }) => {
    await page.goto('/creators');

    await expect(page.getByText('Tope Beats')).toBeVisible();
    await page.getByText('Tope Beats').click();
    await expect(page).toHaveURL(/\/creators\/storefront\/cr_tope/);
    // Bio only renders on the storefront — the discover card shows handle +
    // category + price instead.
    await expect(page.getByText('Afrobeats producer. New packs weekly.')).toBeVisible();
  });
});

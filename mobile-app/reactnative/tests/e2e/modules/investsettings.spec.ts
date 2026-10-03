import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Invest settings hub. EXPO_PUBLIC_SETTINGS_USE_MOCK defaults true — the
 * profile card comes from MOCK_PROFILE (Adaeze Okafor, KYC Tier 2, balanced
 * risk) and the banks screen from MOCK_BANKS in settings.mock.ts, so no
 * endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Invest Settings E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the profile card and account rows', async ({ page }) => {
    await page.goto('/invest-settings');

    await expect(page.getByText('Invest settings')).toBeVisible();
    // Name renders twice (profile card + Profile row value) — assert the card.
    await expect(page.getByText('Adaeze Okafor').first()).toBeVisible();
    await expect(page.getByText('adaeze.okafor@example.com')).toBeVisible();
    await expect(page.getByText('KYC details')).toBeVisible();
    await expect(page.getByText('Tier 2')).toBeVisible();
    await expect(page.getByText('Risk profile')).toBeVisible();
    await expect(page.getByText('Balanced')).toBeVisible();
  });

  test('shows the money and security menu entries', async ({ page }) => {
    await page.goto('/invest-settings');

    await expect(page.getByText('Linked banks')).toBeVisible();
    await expect(page.getByText('Fee schedule')).toBeVisible();
    await expect(page.getByText('Statements & tax docs')).toBeVisible();
    await expect(page.getByText('Security center')).toBeVisible();
    await expect(page.getByText('Help & support')).toBeVisible();
  });

  test('Linked banks opens the seeded accounts list', async ({ page }) => {
    await page.goto('/invest-settings');

    await page.getByText('Linked banks').click();
    await expect(page).toHaveURL(/\/invest-settings\/banks/);
    // Seeded from MOCK_BANKS (the hub stays mounted-but-hidden).
    await expect(page.getByText('Guaranty Trust Bank')).toBeVisible();
    await expect(page.getByText('Access Bank')).toBeVisible();
  });
});

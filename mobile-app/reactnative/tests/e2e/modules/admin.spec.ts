import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Admin Console. EXPO_PUBLIC_ADMIN_USE_MOCK defaults true — the KPI grid is
 * MOCK_DASHBOARD (184,206 users, 37 open KYC, …) and the section menu is
 * permission-filtered for the seeded 'Super Admin' role (AdminRoleProvider's
 * default), so every nav section renders. The admin_console feature flag is
 * documented on the layout but not enforced at route level.
 */
test.describe('Admin E2E - console dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders the KPI grid and the section menu', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByText('Admin Console')).toBeVisible();
    await expect(page.getByText('Operations & oversight')).toBeVisible();
    await expect(page.getByText('Acting as')).toBeVisible();
    await expect(page.getByText('Total users')).toBeVisible();
    await expect(page.getByText('184,206')).toBeVisible();
    await expect(page.getByText('Open KYC')).toBeVisible();
    await expect(page.getByText('Sections')).toBeVisible();
    await expect(page.getByText('KYC Queue')).toBeVisible();
    // Exact — 'Pending withdrawals' in the KPI grid is a substring collision.
    await expect(page.getByText('Withdrawals', { exact: true })).toBeVisible();
    await expect(page.getByText('Audit Log')).toBeVisible();
  });

  test('role chip opens the switcher and switching gates the sections', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByText('Admin Console')).toBeVisible();
    await page.getByLabel('Change admin role').click();
    await expect(page.getByText('Switch role')).toBeVisible();
    // ContentAdmin holds only flag.toggle — the menu should collapse to the
    // one section that role can act on.
    await page.getByText('Content', { exact: true }).click();
    await expect(page.getByText('Feature Flags')).toBeVisible();
    await expect(page.getByText('KYC Queue')).toBeHidden();
  });
});

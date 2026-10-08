import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate Admin control panel. EXPO_PUBLIC_ESTATEADMIN_USE_MOCK defaults true,
 * so the summary (86 residents, 64 properties, attention counts) comes from
 * estateadmin/api.ts's fixture and the ADMIN_ACTIONS tile grid is static.
 */
test.describe('Estate admin E2E - control panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders stats, the needs-attention list and quick actions', async ({ page }) => {
    await page.goto('/estate-admin');

    await expect(page.getByText('Estate control panel')).toBeVisible();
    // Stat strip from the seeded summary.
    await expect(page.getByText('Residents').first()).toBeVisible();
    await expect(page.getByText('Upcoming meetings')).toBeVisible();
    // Attention items (all five counts are > 0 in the fixture).
    await expect(page.getByText('Needs attention')).toBeVisible();
    await expect(page.getByText('Join requests')).toBeVisible();
    await expect(page.getByText('Open emergencies')).toBeVisible();
    await expect(page.getByText('Unpaid invoices')).toBeVisible();
    // Quick-action tiles.
    await expect(page.getByText('Quick actions')).toBeVisible();
    await expect(page.getByText('Post notice')).toBeVisible();
    await expect(page.getByText('AI notes')).toBeVisible();
    await expect(page.getByText('Vendors')).toBeVisible();
  });

  test('the residents tile opens the residents screen', async ({ page }) => {
    await page.goto('/estate-admin');

    // "Residents" is both a stat label and a tile label — the tile is a
    // Pressable with accessibilityRole="button".
    await page.getByRole('button', { name: 'Residents' }).click();
    await expect(page).toHaveURL(/\/estate-admin\/residents/);
    // Mock listResidents returns [] → honest empty state.
    await expect(page.getByText('Manage access')).toBeVisible();
    await expect(page.getByText('No residents')).toBeVisible();
  });
});

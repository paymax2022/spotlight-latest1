import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate Properties hub. EXPO_PUBLIC_PROPERTIES_USE_MOCK defaults true, so the
 * unit list and occupancy summary come from properties/api.ts mockProperties
 * (A-01…SHOP-1 on est_amber_court). /properties has no routeModuleKeys entry,
 * so no registry stub is needed.
 */
test.describe('Properties E2E - estate units hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the summary, occupancy filters and seeded units', async ({ page }) => {
    await page.goto('/properties');

    await expect(page.getByText('Properties', { exact: true })).toBeVisible();
    // Summary strip: 5 units, 3 occupied, 1 vacant → 60% occupancy.
    await expect(page.getByText('Units')).toBeVisible();
    await expect(page.getByText('Occupancy')).toBeVisible();
    // Filter segment (role=tab so the occupancy chips on unit cards can't collide).
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reserved' })).toBeVisible();
    // Seeded units.
    await expect(page.getByText('A-01', { exact: true })).toBeVisible();
    await expect(page.getByText('B-07', { exact: true })).toBeVisible();
    await expect(page.getByText('SHOP-1', { exact: true })).toBeVisible();
    await expect(page.getByText('Ngozi Okeke (tenant)')).toBeVisible();
    await expect(page.getByText('BrightMart (tenant)')).toBeVisible();
  });

  test('the vacant filter narrows the list to the one vacant unit', async ({ page }) => {
    await page.goto('/properties');

    // "Vacant" appears three times — the summary stat label, the segment chip
    // and B-07's occupancy chip — so target the tab role directly.
    await page.getByRole('tab', { name: 'Vacant' }).click();

    await expect(page.getByText('B-07', { exact: true })).toBeVisible();
    await expect(page.getByText('Aisha Bello (owner)')).toBeVisible();
    // Occupied/reserved units drop out of the filtered list.
    await expect(page.getByText('A-01', { exact: true })).toHaveCount(0);
    await expect(page.getByText('SHOP-1', { exact: true })).toHaveCount(0);
  });
});

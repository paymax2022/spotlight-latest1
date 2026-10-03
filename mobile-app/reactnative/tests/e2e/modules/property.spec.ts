import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Property hub. EXPO_PUBLIC_PROPERTY_USE_MOCK defaults true, so the context
 * switcher (Lekki Gardens Estate) and rent passport come from property/mock.ts.
 * The pillar grid is filtered through the module-visibility registry
 * (marketplace/rent → 'realtor', stays → 'stays', estate → 'estate'), so the
 * registry answer is stubbed rather than trusted.
 */
test.describe('Property E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['realtor', 'stays', 'estate']);
    await loginAs(page);
  });

  test('renders the four pillars, active context and account actions', async ({ page }) => {
    await page.goto('/property');

    await expect(page.getByText('Property', { exact: true })).toBeVisible();
    await expect(page.getByText('What do you need?')).toBeVisible();
    // Pillar cards — exact match so the "Marketplace · Stays · Rent · Estate"
    // subtitle can't satisfy the locator.
    await expect(page.getByText('Marketplace', { exact: true })).toBeVisible();
    await expect(page.getByText('Stays', { exact: true })).toBeVisible();
    await expect(page.getByText('Rent & Tenancy', { exact: true })).toBeVisible();
    await expect(page.getByText('Estate & Visitor Access', { exact: true })).toBeVisible();
    // Mock context envelope seeds the switcher pill.
    await expect(page.getByText('Lekki Gardens Estate')).toBeVisible();
    // Cross-pillar account actions.
    await expect(page.getByText('Add a role')).toBeVisible();
    await expect(page.getByText('Rent passport', { exact: true })).toBeVisible();
  });

  test('rent passport link opens the seeded tenancy record', async ({ page }) => {
    await page.goto('/property');

    await page.getByText('Rent passport', { exact: true }).click();
    await expect(page).toHaveURL(/\/property\/rent-passport/);
    // MOCK_RENT_PASSPORT: score 86, 12 payments at 12B Admiralty Way.
    await expect(page.getByText('Rent passport score')).toBeVisible();
    await expect(page.getByText('Recent payments')).toBeVisible();
    await expect(page.getByText('12B Admiralty Way').first()).toBeVisible();
  });
});

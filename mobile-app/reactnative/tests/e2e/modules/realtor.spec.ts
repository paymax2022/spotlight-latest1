import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Spotlight Realtor marketplace hub. EXPO_PUBLIC_REALTOR_USE_MOCK defaults
 * true, so rails come from realtor.mock.ts (3-Bedroom Serviced Apartment,
 * Lekki Phase 1 …). /realtor is gated on the 'realtor' registry key, so the
 * visibility answer is stubbed.
 */
test.describe('Realtor E2E - marketplace hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['realtor']);
    await loginAs(page);
  });

  test('renders the hub with seeded rails, shortcuts and the owner banner', async ({ page }) => {
    await page.goto('/realtor');

    await expect(page.getByText('Spotlight Realtor')).toBeVisible();
    await expect(page.getByText('Verified homes & stays')).toBeVisible();
    // Funnel shortcuts.
    await expect(page.getByText('My inspections')).toBeVisible();
    await expect(page.getByText('My applications')).toBeVisible();
    await expect(page.getByText('Maintenance')).toBeVisible();
    // Seeded rails — the mock listing appears in several rails, so first().
    await expect(page.getByText('Featured', { exact: true })).toBeVisible();
    await expect(page.getByText('Verified listings', { exact: true })).toBeVisible();
    await expect(page.getByText('Popular areas')).toBeVisible();
    await expect(page.getByText('Newest listings', { exact: true })).toBeVisible();
    await expect(page.getByText('3-Bedroom Serviced Apartment, Lekki Phase 1').first()).toBeVisible();
    // Landlord entry.
    await expect(page.getByText('Own or manage property?')).toBeVisible();
  });

  test('my inspections shortcut opens the seeded viewing', async ({ page }) => {
    await page.goto('/realtor');

    await page.getByText('My inspections').click();
    await expect(page).toHaveURL(/\/realtor\/inspection/);
    // MOCK_INSPECTIONS seeds a confirmed viewing of ls_001.
    await expect(page.getByText("Viewings you've booked")).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    // The hub stays mounted-but-hidden, so last() lands on the pushed screen's copy.
    await expect(page.getByText('3-Bedroom Serviced Apartment, Lekki Phase 1').last()).toBeVisible();
  });
});

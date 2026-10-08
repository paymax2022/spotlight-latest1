import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Stays hotelier hub (/stays/host). EXPO_PUBLIC_STAYS_HOTELIER_USE_MOCK
 * defaults FALSE — the mock is an in-memory stub with no seeded properties —
 * so GET /api/v1/stays/extranet/me/properties is route-mocked instead.
 * /stays/* is gated on the 'stays' registry key.
 */
async function mockMyProperties(page: Parameters<typeof loginAs>[0], properties: unknown[]) {
  await page.route('**/api/v1/stays/extranet/me/properties**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: properties }),
    });
  });
}

const SEEDED = [
  { id: 'p1', name: 'Sunrise Suites', city: 'Lagos', status: 'ACTIVE', role: 'OWNER' },
  { id: 'p2', name: 'Palm Grove Shortlet', city: 'Abuja', status: 'PENDING_REVIEW', role: 'MANAGER' },
];

test.describe('Stays hotelier E2E - host properties', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockModuleVisibility(page, ['stays']);
  });

  test('renders the host list with statuses and roles', async ({ page }) => {
    await mockMyProperties(page, SEEDED);
    await loginAs(page);

    await page.goto('/stays/host');

    await expect(page.getByText('Your properties')).toBeVisible();
    await expect(page.getByText('Hotels & shortlets you list on Paymax')).toBeVisible();
    await expect(page.getByText('Sunrise Suites')).toBeVisible();
    await expect(page.getByText('Lagos · OWNER')).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.getByText('Palm Grove Shortlet')).toBeVisible();
    await expect(page.getByText('Pending review')).toBeVisible();
    await expect(page.getByText('List another property')).toBeVisible();
  });

  test('an empty portfolio shows the honest empty state and the list CTA', async ({ page }) => {
    await mockMyProperties(page, []);
    await loginAs(page);

    await page.goto('/stays/host');

    await expect(page.getByText('No properties yet')).toBeVisible();
    await expect(page.getByText('List your first hotel or shortlet apartment to start taking bookings.')).toBeVisible();

    await page.getByText('List a property', { exact: true }).click();
    await expect(page).toHaveURL(/\/stays\/host\/create/);
    // The hub stays mounted-but-hidden, so assert a label unique to the form.
    await expect(page.getByText('Property name')).toBeVisible();
  });
});

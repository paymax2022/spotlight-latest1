import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Health hub. The feature ships an in-app mock layer
 * (EXPO_PUBLIC_HEALTH_USE_MOCK defaults true), so the hub summary renders with
 * no endpoint mocks — records/orders/consults come from health.mock.ts.
 * The promotions banner is the one live call on the screen; stub it so a
 * flaky :8091 can't slow the test (its client swallows errors, but a slow
 * response is still a wasted 30s timeout window).
 */
async function mockPromotions(page: Parameters<typeof loginAs>[0]) {
  await page.route('**/api/v1/promotions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ banners: [] }),
    });
  });
}

test.describe('Health E2E - care hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await mockPromotions(page);
    await loginAs(page);
  });

  test('renders the hub with the care-loop entry points', async ({ page }) => {
    await page.goto('/health');

    await expect(page.getByText('Your connected care loop')).toBeVisible();
    await expect(page.getByText('Symptom Checker')).toBeVisible();
    // Tile labels must be exact — record provider names like "HealthPlus
    // Pharmacy" would otherwise also match the substring.
    await expect(page.getByText('Pharmacy', { exact: true })).toBeVisible();
    await expect(page.getByText('Lab Tests', { exact: true })).toBeVisible();
    await expect(page.getByText('Vet Care', { exact: true })).toBeVisible();
    await expect(page.getByText('Your data, your control')).toBeVisible();
  });

  test('shows seeded consults, orders and recent records', async ({ page }) => {
    await page.goto('/health');

    // One scheduled consult: vet Dr. Bisi Adeyemi for Milo.
    await expect(page.getByText('Active consults')).toBeVisible();
    await expect(page.getByText(/Dr\. Bisi Adeyemi · Milo/)).toBeVisible();
    // Active orders from the pharmacy + lab verticals.
    await expect(page.getByText('Active orders')).toBeVisible();
    await expect(page.getByText('Amlodipine 5mg ×1')).toBeVisible();
    // Recent records — top 3 by issuedAt.
    await expect(page.getByText('Recent records')).toBeVisible();
    await expect(page.getByText('Full Blood Count (FBC)')).toBeVisible();
  });

  test('symptom checker card opens triage', async ({ page }) => {
    await page.goto('/health');

    await page.getByText('Symptom Checker').click();
    await expect(page).toHaveURL(/\/health\/triage/);
  });
});

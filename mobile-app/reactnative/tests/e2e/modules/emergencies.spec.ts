import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Emergencies hub (estate panic/alerts). The feature ships an in-app mock
 * layer (EXPO_PUBLIC_EMERGENCIES_USE_MOCK defaults true), so the alert feed
 * renders with no endpoint mocks — alerts come from the seeded list in
 * src/features/emergencies/api.ts.
 */
test.describe('Emergencies E2E - alerts hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the panic CTA and seeded alerts', async ({ page }) => {
    await page.goto('/emergencies');

    await expect(page.getByText('Emergencies', { exact: true })).toBeVisible();
    await expect(page.getByText('Report an emergency')).toBeVisible();
    // Seeded: a responding security alert at Block A and a resolved noise
    // complaint at Block C, Flat 9.
    await expect(page.getByText('Security · Block A')).toBeVisible();
    await expect(page.getByText('Two unknown individuals loitering near Block A.')).toBeVisible();
    await expect(page.getByText('Noise · Block C, Flat 9')).toBeVisible();
  });

  test('panic button opens the report screen', async ({ page }) => {
    await page.goto('/emergencies');

    await page.getByText('Report an emergency').click();
    await expect(page).toHaveURL(/\/emergencies\/report/);
    await expect(page.getByText('Report emergency')).toBeVisible();
  });
});

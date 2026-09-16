import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockBillsCatalog } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Validation and error states', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('rejects invalid Nigerian phone number for airtime', async ({ page }) => {
    await page.goto('/services/airtime');
    await page.getByText('MTN').first().click();
    await page.getByPlaceholder('0801 234 5678').fill('12345');
    await page.getByText('Review Purchase').click();

    await expect(page.getByText(/valid phone number|valid Nigerian phone number/i).first()).toBeVisible();
  });

  test('surfaces provider catalog load failure for airtime networks', async ({ page }) => {
    // getAirtimeNetworks reads Supabase (utility_billers), not the legacy
    // /services/airtime/networks REST route, so the failure has to be injected there.
    await page.route('**/rest/v1/utility_billers**', async (route) => {
      if (route.request().url().includes('category=eq.airtime')) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Provider unavailable' }) });
      }
      return route.fallback();
    });

    await page.goto('/services/airtime');
    // The query retries once before settling into the error state, so allow
    // longer than the default expect timeout.
    await expect(page.getByText('Could not load networks. Tap to retry.')).toBeVisible({ timeout: 25_000 });
  });

  test('surfaces customer validation failure for electricity meter lookup', async ({ page }) => {
    // validateMeter posts to /api/v1/utility/validate (postUtilityValidation).
    await page.route('**/api/v1/utility/validate', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'INVALID_METER', message: 'Meter not found' }) });
    });

    await page.goto('/services/electricity');
    await page.getByText('IKEDC').first().click();
    await page.getByPlaceholder('1234 5678 9012').fill('999999');
    await page.getByText('Validate Meter').click();

    await expect(page.getByText('Unable to validate meter number. Please check the number and try again.')).toBeVisible();
  });
});

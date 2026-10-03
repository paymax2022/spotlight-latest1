import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Crypto hub. EXPO_PUBLIC_CRYPTO_USE_MOCK defaults true: portfolio, assets and
 * eligibility are served by the in-app mock (eligibility returns `eligible`,
 * so the holdings hero — not the KYC gate — renders).
 */
test.describe('Crypto E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('eligible user sees holdings hero and the buy CTA', async ({ page }) => {
    await page.goto('/crypto');

    await expect(page.getByText('Crypto holdings value')).toBeVisible();
    await expect(page.getByText('Available to invest')).toBeVisible();
    await expect(page.getByText('Buy crypto')).toBeVisible();
  });

  test('asset list renders the mock markets', async ({ page }) => {
    await page.goto('/crypto');

    await expect(page.getByText('BTC').first()).toBeVisible();
    await expect(page.getByText('ETH').first()).toBeVisible();
  });
});

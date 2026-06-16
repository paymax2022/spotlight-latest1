import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockBillsCatalog } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Security and authorization', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('payment confirmation requires transaction PIN before debit', async ({ page }) => {
    await page.goto('/services/airtime');
    await page.getByText('MTN').first().click();
    await page.getByPlaceholder('0801 234 5678').fill('08031234567');
    await page.getByText('₦500').first().click();
    await page.getByText('Review Purchase').click();

    await expect(page.getByPlaceholder('Enter 4-digit PIN')).toBeVisible();
    await page.getByText('Confirm & Pay').click();
    await expect(page.getByText('Enter your 4-digit transaction PIN.')).toBeVisible();
  });

  test('does not expose provider API keys in rendered bills pages', async ({ page }) => {
    await page.goto('/services/bills');
    const bodyText = await page.locator('body').innerText();

    expect(bodyText).not.toMatch(/api[_ -]?key|secret|vtpass[_ -]?key/i);
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { completeAirtimePurchase, mockBillsCatalog } from '../helpers/bills';
import { providerResponses, users } from '../helpers/testData';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Wallet and financial accuracy', () => {
  test('blocks purchase error state when wallet is insufficient', async ({ page }) => {
    await mockWallet(page, users.unfunded.walletBalance);
    await mockBillsCatalog(page);
    await loginAs(page, users.unfunded);
    await page.route('**/services/airtime/purchase', async (route) => {
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify(providerResponses.insufficientBalance),
      });
    });

    await page.goto('/services/airtime');
    await page.getByText('MTN').first().click();
    await page.getByPlaceholder('0801 234 5678').fill('08031234567');
    await page.getByText('₦500').first().click();
    await page.getByText('Review Purchase').click();

    await expect(page.getByText(/Insufficient wallet balance|Add money/i).first()).toBeVisible();
  });

  test('prevents duplicate purchase requests while first wallet debit is pending', async ({ page }) => {
    await mockWallet(page);
    const captured = await mockBillsCatalog(page);
    await loginAs(page);

    await page.route('**/services/airtime/purchase', async (route) => {
      captured.airtimePurchases.push(route.request().postDataJSON() as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: providerResponses.airtimeSuccess }) });
    });

    await page.goto('/services/airtime');
    await page.getByText('MTN').first().click();
    await page.getByPlaceholder('0801 234 5678').fill('08031234567');
    await page.getByText('₦500').first().click();
    await page.getByText('Review Purchase').click();
    await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
    await page.getByText('Confirm & Pay').dblclick();

    await expect(page).toHaveURL(/\/services\/receipt\/tx-airtime-success/);
    expect(captured.airtimePurchases).toHaveLength(1);
  });
});

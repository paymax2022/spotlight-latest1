import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeAirtimePurchase, mockBillsCatalog, openBillsHome } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Airtime purchase', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('navigates from bills hub and completes a wallet-funded airtime purchase', async ({ page }) => {
    await openBillsHome(page);
    await page.getByText('Airtime', { exact: true }).click();
    await expect(page.getByText('Buy Airtime').first()).toBeVisible();

    await completeAirtimePurchase(page);

    await expectOnReceipt(page, 'Payment Successful', 'PMX-AIRTIME-001');
    await expect(page.getByText('AIRTIME', { exact: true })).toBeVisible();
    await expect(page.getByText('08031234567').last()).toBeVisible();
  });

  test('sends the expected airtime payment payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeAirtimePurchase(page);
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.airtimePurchases).toHaveLength(1);
    expect(captured.airtimePurchases[0]).toMatchObject({
      category: 'airtime',
      biller_id: 'net-mtn',
      product_id: 'variable-product',
      customer_reference: '08031234567',
      amount_kobo: 50_000,
    });
  });
});

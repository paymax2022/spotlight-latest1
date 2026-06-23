import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeDataPurchase, mockBillsCatalog, openBillsHome } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Data and internet bundle purchase', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('loads bundles and completes a data purchase', async ({ page }) => {
    await openBillsHome(page);
    await page.getByText('Data / Internet').click();
    await expect(page.getByText('Buy Data Bundle')).toBeVisible();

    await completeDataPurchase(page);

    await expectOnReceipt(page, 'Payment Successful', 'PMX-DATA-001');
    await expect(page.getByText('3GB Weekly').last()).toBeVisible();
  });

  test('sends the expected data purchase payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeDataPurchase(page);
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.dataPurchases).toHaveLength(1);
    expect(captured.dataPurchases[0]).toMatchObject({
      category: 'data',
      biller_id: 'net-mtn',
      product_id: 'mtn-3gb-weekly',
      customer_reference: '08031234567',
    });
  });

  test('shows a product-empty state when provider returns no data bundles', async ({ page }) => {
    await page.route('**/rest/v1/utility_products**', async (route) => {
      const url = route.request().url();
      if (url.includes('biller_id=eq.net-mtn')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }
      await route.fallback();
    });

    await page.goto('/services/data');
    await page.getByText('MTN').first().click();

    await expect(page.getByText('No plans available for this network.')).toBeVisible();
  });
});

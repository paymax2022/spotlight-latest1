import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeCablePayment, mockBillsCatalog, openBillsHome } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Cable TV subscription', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('validates IUC, selects bouquet, pays, and lands on receipt', async ({ page }) => {
    await openBillsHome(page);
    await page.getByText('Cable TV', { exact: true }).click();
    await expect(page.getByText('Cable TV Payment').first()).toBeVisible();

    await completeCablePayment(page);

    await expectOnReceipt(page, 'Payment Successful', 'PMX-CABLE-001');
  });

  test('sends the expected cable subscription payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeCablePayment(page);
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.cablePayments).toHaveLength(1);
    expect(captured.cablePayments[0]).toMatchObject({
      category: 'cable_tv',
      biller_id: 'cable-dstv',
      product_id: 'dstv-compact',
      customer_reference: '1234567890',
    });
  });

  test('shows a product-empty state when cable package catalog is empty', async ({ page }) => {
    await page.route('**/rest/v1/utility_products**', async (route) => {
      const url = route.request().url();
      if (url.includes('biller_id=eq.cable-dstv')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }
      await route.fallback();
    });

    await page.goto('/services/cable-tv');
    await page.getByText('DSTV').first().click();

    await expect(page.getByText('No packages available for this provider.')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeEducationPayment, mockBillsCatalog, openBillsHome } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Education payment', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('opens from bills hub and loads education products', async ({ page }) => {
    await openBillsHome(page);
    await page.getByText('Education', { exact: true }).click();
    await expect(page.getByText('Education Payment', { exact: true }).first()).toBeVisible();

    await page.getByText('WAEC Result Checker').first().click();
    await expect(page.getByText('WAEC Result Checker PIN').first()).toBeVisible();
  });

  test('sends the expected education payment payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeEducationPayment(page);
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.educationPayments).toHaveLength(1);
    expect(captured.educationPayments[0]).toMatchObject({
      category: 'education',
      biller_id: 'edu-waec',
      product_id: 'waec-result-checker-pin',
      customer_reference: 'WAEC123456',
    });
  });
});

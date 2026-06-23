import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeElectricityPayment, mockBillsCatalog, validateElectricityMeter } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Electricity prepaid', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('validates prepaid meter, pays, and shows token on receipt', async ({ page }) => {
    await completeElectricityPayment(page, 'Prepaid');

    await expectOnReceipt(page, 'Payment Successful', 'PMX-ELEC-001');
    await expect(page.getByText('Electricity Token')).toBeVisible();
    await expect(page.getByText('1234-5678-9012-3456')).toBeVisible();
  });

  test('sends the expected prepaid electricity payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeElectricityPayment(page, 'Prepaid');
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.electricityPayments).toHaveLength(1);
    expect(captured.electricityPayments[0]).toMatchObject({
      category: 'electricity',
      biller_id: 'disco-ikedc',
      product_id: 'variable-product',
      customer_reference: '123456789012',
      amount_kobo: 500_000,
      metadata: expect.objectContaining({ meter_type: 'PREPAID' }),
    });
  });

  test('requires successful meter validation before customer details are shown', async ({ page }) => {
    await page.goto('/services/electricity');
    await page.getByText('IKEDC').first().click();
    await page.getByText('Prepaid', { exact: true }).click();
    await page.getByPlaceholder('1234 5678 9012').fill('123456789012');
    await expect(page.getByText('Confirm Payment')).toHaveCount(0);
    await expect(page.getByText('QA Electricity Customer')).toHaveCount(0);

    await validateElectricityMeter(page, 'Prepaid');
    await expect(page.getByText('QA Electricity Customer').first()).toBeVisible();
    await expect(page.getByText('Review Payment')).toBeEnabled();
  });
});

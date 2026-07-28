import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeElectricityPayment, mockBillsCatalog } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Electricity postpaid', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('sends the expected postpaid electricity payload with an idempotency key', async ({ page }) => {
    const captured = await mockBillsCatalog(page);

    await completeElectricityPayment(page, 'Postpaid');
    await expect(page.getByText('Payment Successful')).toBeVisible();

    expect(captured.electricityPayments).toHaveLength(1);
    expect(captured.electricityPayments[0]).toMatchObject({
      category: 'electricity',
      biller_id: 'disco-ikedc',
      product_id: 'variable-product',
      customer_reference: '123456789012',
      amount_kobo: 1_000_000,
      metadata: expect.objectContaining({ meter_type: 'POSTPAID' }),
    });
  });

  test('validates postpaid customer and pays without prepaid token expectation', async ({ page }) => {
    await completeElectricityPayment(page, 'Postpaid');

    await expectOnReceipt(page, 'Payment Successful', 'PMX-ELEC-002');
    await expect(page.getByText('Postpaid Electricity')).toBeVisible();
    await expect(page.getByText('Electricity Token')).toHaveCount(0);
  });
});

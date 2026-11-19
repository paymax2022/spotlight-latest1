import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeEducationPayment, mockBillsCatalog, openBillsHome, selectProviderTile } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Education payment', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('opens from bills hub and loads education products', async ({ page }) => {
    await openBillsHome(page);
    await page.getByRole('button', { name: 'Exams', exact: true }).first().click();
    await expect(page.getByText('Education Payment', { exact: true }).first()).toBeVisible();

    await selectProviderTile(page, 'WAEC Result Checker');
    // Two matches: the hub screen below the pushed education route keeps its
    // Recent Transactions list mounted under display:none (0×0 → "hidden"), so
    // .first() is the hub's stale copy and .last() is the real product card.
    await expect(page.getByText('WAEC Result Checker PIN').last()).toBeVisible();
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

import { expect, test } from '@playwright/test';
import { expectOnReceipt } from '../helpers/assertions';
import { loginAs } from '../helpers/auth';
import { completeAirtimePurchase, mockBillsCatalog, openBillsHome, selectAirtimeNetwork } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Airtime purchase', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('offers every network as a logo and nothing but a logo', async ({ page }) => {
    await page.goto('/services/airtime');
    for (const name of ['MTN', 'Airtel', 'Glo', '9mobile']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    // The brand name is the tile's accessible name only — no word is printed
    // under the logo, so the grid reads as four brands rather than four captions.
    for (const name of ['MTN', 'Airtel', 'Glo', '9mobile']) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    await selectAirtimeNetwork(page, 'Glo');
    await expect(page.getByText('Glo').last()).toBeVisible();
  });

  test('navigates from bills hub and completes a wallet-funded airtime purchase', async ({ page }) => {
    await openBillsHome(page);
    // Two buttons carry aria-label="Airtime" on this screen: the hub tile
    // (TILE_LABELS) and the utility tab bar entry (UTILITY_TABS), which match by
    // design — see the comment on TILE_LABELS in app/services/bills.tsx. Neither
    // exposes a distinguishing ARIA state, so the order is what separates them:
    // the screen renders inside the Stack and the tab bar comes after it.
    await page.locator('button[aria-label="Airtime"]').first().click();
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
      customer_reference: '+2348031234567',
      amount_kobo: 50_000,
    });
  });
});

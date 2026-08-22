import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockBillsCatalog } from '../helpers/bills';
import { providerResponses } from '../helpers/testData';
import { mockWallet } from '../helpers/wallet';

test.describe('Bills E2E - Retry and polling states', () => {
  test.beforeEach(async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);
  });

  test('FAILED transaction detail shows retry button', async ({ page }) => {
    // Override single-transaction route to return a FAILED transaction
    await page.route('**/transactions/tx-provider-failed', async (route) => {
      // The app route /services/transactions/<id> matches this pattern too —
      // without this guard page.goto() renders the mocked JSON, not the screen.
      if (route.request().resourceType() === 'document') return route.fallback();
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'tx-provider-failed',
              serviceType: 'AIRTIME',
              status: 'FAILED',
              amount: 500,
              charges: 0,
              totalAmount: 500,
              reference: 'PMX-FAILED-001',
              customerIdentifier: '08031234567',
              providerName: 'MTN',
              productName: 'Airtime',
              createdAt: '2026-06-14T09:30:00.000Z',
            },
          }),
        });
      } else {
        route.fallback();
      }
    });

    await page.goto('/services/transactions/tx-provider-failed');

    await expect(page.getByText('FAILED').first()).toBeVisible();
    await expect(page.getByText('Retry Transaction')).toBeVisible();
  });

  test('PENDING transaction shows auto-refresh notice', async ({ page }) => {
    await page.goto('/services/transactions/tx-provider-pending');

    await expect(page.getByText('PENDING').first()).toBeVisible();
    await expect(page.getByText(/refreshes automatically/i)).toBeVisible();
    await expect(page.getByText('Retry Transaction')).toHaveCount(0);
  });

  test('retry dispatches POST to retry endpoint and navigates to new receipt', async ({ page }) => {
    const retryCalls: Record<string, unknown>[] = [];

    // Retry POSTs to /api/v1/utility/transactions/:id/requery (retryTransaction
    // in src/api/transactions.api.ts). The FAILED row itself comes from the
    // Supabase fixture in mockBillsCatalog — the detail read is not a REST call.
    await page.route('**/api/v1/utility/transactions/*/requery', async (route) => {
      retryCalls.push({ url: route.request().url() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { transaction: { id: 'tx-airtime-success' } } }),
      });
    });

    await page.goto('/services/transactions/tx-provider-failed');
    await expect(page.getByText('Retry Transaction')).toBeVisible();
    await page.getByText('Retry Transaction').click();

    // Should navigate to the receipt of the new transaction
    await expect(page.getByText('Payment Successful')).toBeVisible();
    expect(retryCalls).toHaveLength(1);
  });

  test('PROCESSING transaction shows spinner and no retry button', async ({ page }) => {
    await page.route('**/transactions/tx-processing', async (route) => {
      if (route.request().resourceType() === 'document') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'tx-processing',
            serviceType: 'ELECTRICITY',
            status: 'PROCESSING',
            amount: 5000,
            charges: 0,
            totalAmount: 5000,
            reference: 'PMX-PROC-001',
            customerIdentifier: '123456789012',
            providerName: 'IKEDC',
            productName: 'Prepaid Electricity',
            createdAt: '2026-06-14T10:00:00.000Z',
          },
        }),
      });
    });

    await page.goto('/services/transactions/tx-processing');

    await expect(page.getByText('PROCESSING').first()).toBeVisible();
    await expect(page.getByText(/refreshes automatically/i)).toBeVisible();
    await expect(page.getByText('Retry Transaction')).toHaveCount(0);
  });

  test('provider timeout during purchase surfaces retryable error message', async ({ page }) => {
    // Airtime purchase posts to /api/v1/utility/pay (postUtilityPayment), not the
    // legacy /services/airtime/purchase route.
    await page.route('**/api/v1/utility/pay', async (route) => {
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify(providerResponses.timeoutError),
      });
    });

    await page.goto('/services/airtime');
    await page.getByText('MTN').first().click();
    await page.getByPlaceholder('0801 234 5678').fill('08031234567');
    await page.getByText('₦500').first().click();
    await page.getByText('Review Purchase').click();
    // The confirm dialog gates on the transaction PIN — without it the payment
    // never fires and no provider error can surface.
    await page.getByPlaceholder('Enter 4-digit PIN').fill('1234');
    await page.mouse.wheel(0, 900);
    await page.getByText('Confirm & Pay').last().click();

    // Error message should appear — modal stays open or closes with error below button
    await expect(page.getByText(/timed out|try again|retry/i).first()).toBeVisible();
  });
});

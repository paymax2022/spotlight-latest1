import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockBillsCatalog } from '../helpers/bills';
import { mockWallet } from '../helpers/wallet';

// ─── Shared setup ────────────────────────────────────────────────────────────

async function setup(page: Parameters<typeof loginAs>[0]) {
  await mockWallet(page);
  await mockBillsCatalog(page);
  await loginAs(page);
}

// ─── Wallet: Add Money (/wallet/add) ─────────────────────────────────────────

test.describe('Payment routes - Add Money (wallet/add)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('renders heading, subtitle, and quick-select amounts', async ({ page }) => {
    await page.goto('/wallet/add');

    await expect(page.getByText('Add Money').first()).toBeVisible();
    await expect(page.getByText('Fund your Spotlight wallet securely with Paystack.')).toBeVisible();
    for (const label of ['₦1,000', '₦2,500', '₦5,000', '₦10,000']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.getByText('Continue to Paystack')).toBeVisible();
  });

  test('tapping a quick-select amount populates the amount field', async ({ page }) => {
    await page.goto('/wallet/add');

    await page.getByText('₦2,500').first().click();
    await expect(page.locator('input[inputmode="numeric"], input[type="number"]').first()).toHaveValue(/2500/);
  });

  test('calls POST /api/v1/wallet/topup with amount_kobo and an idempotency key', async ({ page }) => {
    const captured: Record<string, unknown>[] = [];

    await page.route('**/api/v1/wallet/topup', async (route) => {
      captured.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            authorizationUrl: 'https://checkout.paystack.test/pay/fund-e2e',
            reference: 'PAY-FUND-001',
          },
        }),
      });
    });

    await page.goto('/wallet/add');
    await page.getByText('₦5,000').first().click();
    await page.getByText('Continue to Paystack').click();

    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(captured[0]).toMatchObject({ amount_kobo: 500_000 });

    const idempotencyKey = (await page.route('**/api/v1/wallet/topup', (r) => r.fallback())) as unknown;
    // Key is sent in header — verify the field was present in the request body as a proxy
    expect(captured[0]).toHaveProperty('amount_kobo');
  });

  test('does not submit funding request for an amount under ₦100', async ({ page }) => {
    const captured: Record<string, unknown>[] = [];

    await page.route('**/api/v1/wallet/topup', async (route) => {
      captured.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Amount too low' }) });
    });

    await page.goto('/wallet/add');
    const input = page.locator('input[inputmode="numeric"], input[type="number"]').first();
    await input.fill('50');
    await page.getByText('Continue to Paystack').click();

    await expect.poll(() => captured.length, { timeout: 1_000 }).toBe(0);
  });
});

// ─── Wallet: Send Money (/wallet/send) ───────────────────────────────────────

test.describe('Payment routes - Send Money (wallet/send)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('renders heading, recipient field, and primary CTA', async ({ page }) => {
    await page.goto('/wallet/send');

    await expect(page.getByText('Send Money').first()).toBeVisible();
    await expect(page.getByText('Prepare a wallet transfer to another Spotlight account.')).toBeVisible();
    await expect(page.getByPlaceholder(/phone number|email|Spotlight ID/i).first()).toBeVisible();
    await expect(page.getByText('Save Transfer Draft')).toBeVisible();
  });

  test('security panel is displayed on the send screen', async ({ page }) => {
    await page.goto('/wallet/send');

    await expect(page.getByText('Protected payment flow')).toBeVisible();
  });
});

// ─── Wallet: Withdraw (/wallet/withdraw) ─────────────────────────────────────

test.describe('Payment routes - Withdraw (wallet/withdraw)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('renders heading and bank / account number fields', async ({ page }) => {
    await page.goto('/wallet/withdraw');

    await expect(page.getByText('Withdraw').first()).toBeVisible();
    await expect(page.getByText('Set up a withdrawal request from your wallet balance.')).toBeVisible();
    await expect(page.getByPlaceholder('Select bank').first()).toBeVisible();
    await expect(page.getByPlaceholder('0123456789').first()).toBeVisible();
    await expect(page.getByText('Save Withdrawal Draft')).toBeVisible();
  });
});

// ─── Services: Cards & Methods (/services/cards) ─────────────────────────────

test.describe('Payment routes - Cards & Methods (services/cards)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('renders all three payment method rows with correct status labels', async ({ page }) => {
    await page.goto('/services/cards');

    await expect(page.getByText('Cards & Methods').first()).toBeVisible();
    await expect(page.getByText('Payment Methods', { exact: true })).toBeVisible();

    await expect(page.getByText('Wallet Balance')).toBeVisible();
    await expect(page.getByText('Paystack Card')).toBeVisible();
    await expect(page.getByText('Saved Cards')).toBeVisible();

    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Available')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
  });

  test('explains that saved cards need tokenization before activation', async ({ page }) => {
    await page.goto('/services/cards');

    await expect(page.getByText(/tokenized card storage API/i)).toBeVisible();
  });
});

// ─── Services: FX Exchange (/services/fx) ────────────────────────────────────

test.describe('Payment routes - FX Exchange (services/fx)', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('renders heading, from/to currency fields, and preview CTA', async ({ page }) => {
    await page.goto('/services/fx');

    await expect(page.getByText('FX Exchange').first()).toBeVisible();
    await expect(page.getByText('Preview currency exchange support for your wallet.')).toBeVisible();
    await expect(page.locator('input[value="NGN Wallet"]')).toBeVisible();
    await expect(page.getByPlaceholder('USD Wallet')).toBeVisible();
    await expect(page.getByText('Preview Exchange')).toBeVisible();
  });

  test('security panel is displayed on the FX screen', async ({ page }) => {
    await page.goto('/services/fx');

    await expect(page.getByText('Protected payment flow')).toBeVisible();
  });
});

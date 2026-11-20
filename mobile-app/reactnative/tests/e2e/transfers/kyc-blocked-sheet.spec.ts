/**
 * The Tier-0 wallet refusal on the wallet→wallet PIN sheet.
 *
 * A Tier-0 member types the CORRECT PIN and the server 403s them: the wallet is
 * switched off until KYC. The sheet used to print that sentence and offer nothing
 * else. These specs drive the real screen and pin three things the unit tests
 * cannot reach:
 *
 *   1. the refusal renders with a working button that lands on /kyc-verify,
 *   2. the button survives on a small viewport alongside a full keypad (the sheet
 *      is not scrollable, so a taller CTA could push the keys off-screen),
 *   3. the button does NOT appear for failures it would mislead about — a wrong
 *      PIN, or a shortfall that belongs to the top-up dialog.
 *
 * The wallet→wallet rail (src/api/transfers.api.ts) has no mock mode — unlike the
 * bank rails, which EXPO_PUBLIC_TRANSFERS_USE_MOCK short-circuits offline — so
 * every response below is a genuine HTTP request intercepted at the network layer.
 *
 * The walk deliberately does NOT use `loginAs`: that helper lands on /home and
 * waits for the services grid, which forces a second route to compile before the
 * one under test. Seeding the session and navigating straight to the money route
 * reaches the same authenticated state in one compile.
 */
import { expect, Page, test } from '@playwright/test';
import { mockAuth, mockPinStatus, seedSession } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';

const WALLET_DISABLED =
  'Wallet is disabled for unverified accounts. Complete KYC to enable your wallet';

// Metro compiles a route the first time the browser asks for it, and this screen
// pulls in the whole transfers feature. Cold, that is tens of seconds — longer
// than the suite's 10s expect default, so a plain `toBeVisible` reads as a broken
// app rather than a busy bundler.
const BUNDLE_TIMEOUT = 150_000;

async function mockRecipientResolve(page: Page) {
  await page.route('**/api/v1/transfers/paymax/resolve**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          recipient: {
            user_id: 'usr-recipient-001',
            display_name: 'Ada Test',
            masked_phone: '0803****567',
          },
        },
      }),
    });
  });
}

/** Answer the POST /transfers/paymax debit with a given failure envelope. */
async function mockTransferFailure(page: Page, status: number, body: Record<string, unknown>) {
  await page.route('**/api/v1/transfers/paymax', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Walk the real Wallet 2 Wallet form to the PIN sheet and enter the PIN. */
async function openPinSheet(page: Page) {
  await mockAuth(page);
  await mockPinStatus(page, true);
  await seedSession(page);
  await mockWallet(page);
  await mockRecipientResolve(page);

  await page.goto('/services/transfer', { waitUntil: 'domcontentloaded' });
  // Wallet→wallet is the default segment, so no tab switch is needed first.
  // The recipient placeholder's wording belongs to a different change (cashtag
  // addressing), so accept either phrasing: this test is about the refusal, not
  // about who owns the label on the input.
  await page.getByPlaceholder(/cashtag, phone, or email|0801 234 5678 or name@email\.com/i)
    .fill('08039876543', { timeout: BUNDLE_TIMEOUT });
  await page.getByPlaceholder('₦0.00').fill('500');
  await page.getByRole('button', { name: 'Continue' }).click();

  const confirm = page.getByRole('button', { name: 'Confirm with PIN' });
  await expect(confirm).toBeVisible({ timeout: BUNDLE_TIMEOUT });
  await confirm.click();
  await expect(page.getByText('Enter transaction PIN')).toBeVisible();

  for (const digit of ['1', '2', '3', '4']) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

test.describe('Wallet transfer — KYC-blocked PIN sheet', () => {
  // A cold Metro outlasts the 45s default on the first navigation of the file;
  // the budget is per test, so every case below pays the compile only once
  // (workers reuse the server).
  test.describe.configure({ timeout: 240_000 });

  test('a coded wallet_disabled offers one tap into KYC', async ({ page }) => {
    await mockTransferFailure(page, 403, { success: false, error: WALLET_DISABLED, code: 'wallet_disabled' });
    await openPinSheet(page);

    await expect(page.getByText(/Wallet is disabled for unverified accounts/)).toBeVisible();

    const cta = page.getByRole('button', { name: 'Verify my account' });
    await expect(cta).toBeVisible();
    // The sheet is a fixed-height bottom sheet, not a ScrollView: the CTA and the
    // keys it sits above must both fit on a small phone.
    await expect(cta).toBeInViewport();
    await expect(page.getByRole('button', { name: '5', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '0', exact: true })).toBeInViewport();

    await cta.click();
    await expect(page).toHaveURL(/\/kyc-verify/);
  });

  // The tier gate only began returning `code` alongside this fix. A client built
  // before it — or one talking to an API that has not deployed yet — still has to
  // recognise the refusal from prose, or the button ships dead.
  test('a prose-only 403 from an undeployed API still gets the button', async ({ page }) => {
    await mockTransferFailure(page, 403, { success: false, error: WALLET_DISABLED });
    await openPinSheet(page);

    await expect(page.getByRole('button', { name: 'Verify my account' })).toBeVisible();
  });

  test('a daily-limit refusal asks to raise the limit', async ({ page }) => {
    await mockTransferFailure(page, 403, {
      success: false,
      error: 'Daily wallet limit of ₦50,000 reached for your KYC tier.',
      code: 'daily_limit_exceeded',
    });
    await openPinSheet(page);

    await expect(page.getByRole('button', { name: 'Raise my limit' })).toBeVisible();
  });

  test('a wrong PIN keeps the keypad and grows no KYC button', async ({ page }) => {
    await mockTransferFailure(page, 403, {
      success: false,
      error: 'Incorrect PIN. 2 attempt(s) remaining.',
      code: 'pin_invalid',
    });
    await openPinSheet(page);

    await expect(page.getByText(/Incorrect PIN/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Verify my account|Raise my limit/ })).toHaveCount(0);
  });

  // Scoped to what this change owns. A 402 shortfall must NOT be dressed up as a
  // tier refusal — that is the false-positive this detector could most easily
  // create, since both arrive as a server sentence under the dots. What the
  // member is then offered (the funding dialog) belongs to the wallet-top-up
  // change and is asserted there, not here: `promptWalletTopUp` is called from
  // `app/social/send.tsx`, never from the transfers rail this spec drives — the
  // PIN sheet has no funding CTA — so expecting its button here would test
  // another surface's work.
  test('a shortfall stays a balance problem, not a KYC problem', async ({ page }) => {
    await mockTransferFailure(page, 402, {
      success: false,
      error: 'Insufficient wallet balance',
      code: 'insufficient_funds',
    });
    await openPinSheet(page);

    await expect(page.getByText(/Insufficient wallet balance/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Verify my account|Raise my limit/ })).toHaveCount(0);
  });
});

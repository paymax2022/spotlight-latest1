/**
 * The Tier-0 wallet refusal on the older /wallet/send rail.
 *
 * /services/transfer collects the PIN in a bottom sheet; /wallet/send collects it
 * inline in a <TripPinInput/> and reports every failure through a dialog. A
 * Tier-0 member who types the correct PIN used to get 'Transfer Failed' with one
 * OK button — a dead end that tells them to complete KYC and then offers no way
 * to do it. These specs pin that the same refusal now carries the same one tap,
 * and that the two rails still agree on which failures get it:
 *
 *   1. wallet_disabled → a confirm whose confirm button starts verification,
 *   2. cancelling keeps the server's reason on screen and goes nowhere,
 *   3. a daily-limit refusal asks to raise the limit rather than verify afresh,
 *   4. a wrong PIN stays on the PIN field and grows no verification offer.
 *
 * The decision itself lives in src/features/transfers/kycBlock.ts and is unit-
 * tested there; what only a browser can prove is that this screen's dialog wiring
 * reaches it — i.e. that the error object still carries `.response` by the time it
 * arrives, because src/api/client.ts rewrites `error.message` in its interceptor.
 */
import { expect, Page, test } from '@playwright/test';
import { mockAuth, mockPinStatus, seedSession } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';

const WALLET_DISABLED =
  'Wallet is disabled for unverified accounts. Complete KYC to enable your wallet';

// Metro compiles a route on first request; /wallet/send pulls in the whole
// payment feature, which cold is far longer than the 10s expect default.
const BUNDLE_TIMEOUT = 150_000;

async function walkToSendFailure(page: Page, failure: { status: number; body: Record<string, unknown> }) {
  await mockAuth(page);
  await mockPinStatus(page, true);
  await seedSession(page);
  await mockWallet(page);

  // The tier read this screen can make on the funding path. Answering it as a
  // Tier-0 profile keeps a harness 401 from being mistaken for the behaviour
  // under test: the interceptor in src/api/client.ts signs the session out on any
  // unmocked 401, which would bounce the run to /login instead of the dialog.
  await page.route('**/api/finance/kyc/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { kyc_tier: 0, tier: 0 } }),
    }),
  );
  await page.route('**/api/v1/transfers/paymax/resolve**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { recipient: { user_id: 'usr-recipient-001', display_name: 'Ada Test', masked_phone: '0803****567' } },
      }),
    }),
  );
  await page.route('**/api/v1/transfers/paymax', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: failure.status,
      contentType: 'application/json',
      body: JSON.stringify(failure.body),
    });
  });

  await page.goto('/wallet/send', { waitUntil: 'domcontentloaded' });
  // Accept either recipient-placeholder wording: the cashtag phrasing arrives
  // with a different change, and this spec only cares about the refusal the
  // server returns after the PIN.
  await page.getByPlaceholder(/cashtag, phone, or email|phone number or email/i)
    .fill('08039876543', { timeout: BUNDLE_TIMEOUT });
  await page.getByPlaceholder('₦0.00').fill('500');
  await page.getByRole('button', { name: 'Preview Transfer' }).click();

  const send = page.getByRole('button', { name: 'Confirm & Send' });
  await expect(send).toBeVisible({ timeout: BUNDLE_TIMEOUT });

  // TripPinInput keeps its real <input> invisible (opacity 0, 1x1) and renders
  // the four boxes from its value, so it is driven by label, not by the boxes.
  const pin = page.getByLabel('Trip PIN');
  await pin.fill('1234');
  await send.click();
}

test.describe('Send Money — KYC-blocked transfer refusal', () => {
  test.describe.configure({ timeout: 240_000 });

  test('wallet_disabled offers verification instead of a bare OK', async ({ page }) => {
    await walkToSendFailure(page, {
      status: 403,
      body: { success: false, error: WALLET_DISABLED, code: 'wallet_disabled' },
    });

    // <ConfirmHost> marks its card accessibilityRole="alert", so scoping to it
    // separates the dialog's copy from the same sentence this screen also leaves
    // under the PIN boxes — unscoped, getByText resolves both and fails strict mode.
    const dialog = page.getByRole('alert');
    await expect(dialog.getByText('Verify your account to send money')).toBeVisible();
    // The server's own wording is the dialog body — not a generic paraphrase.
    await expect(dialog.getByText(/Wallet is disabled for unverified accounts/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Verify my account' }).click();
    await expect(page).toHaveURL(/\/kyc-verify/);
  });

  test('declining leaves the reason visible and goes nowhere', async ({ page }) => {
    await walkToSendFailure(page, {
      status: 403,
      body: { success: false, error: WALLET_DISABLED, code: 'wallet_disabled' },
    });

    await page.getByRole('alert').getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page).not.toHaveURL(/kyc-verify/);
    // The refusal must survive the dialog closing, or the member is left with a
    // PIN field that looks as if retyping it would help. With the dialog gone,
    // this is the one remaining copy of the sentence — the inline error under the
    // boxes, rendered by TripPinInput.
    await expect(page.getByText(/Wallet is disabled for unverified accounts/)).toBeVisible();
  });

  test('a daily-limit refusal asks to raise the limit', async ({ page }) => {
    await walkToSendFailure(page, {
      status: 403,
      body: {
        success: false,
        error: 'Daily wallet limit of ₦50,000 reached for your KYC tier.',
        code: 'daily_limit_exceeded',
      },
    });

    const dialog = page.getByRole('alert');
    await expect(dialog.getByText('Daily limit reached')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Raise my limit' })).toBeVisible();
  });

  test('a wrong PIN stays a PIN error and grows no verification offer', async ({ page }) => {
    await walkToSendFailure(page, {
      status: 403,
      body: { success: false, error: 'Incorrect PIN. 2 attempt(s) remaining.', code: 'pin_invalid' },
    });

    await expect(page.getByText(/Incorrect PIN/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Verify my account|Raise my limit/ })).toHaveCount(0);
  });
});

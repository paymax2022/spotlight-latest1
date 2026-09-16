import { expect, test, type Page } from '@playwright/test';
import { loginAs, mockPinStatus, TEST_TXN_PIN } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockBillsCatalog } from '../helpers/bills';

/**
 * TripPinInput renders visible digit boxes over a deliberately hidden
 * TextInput (opacity 0, 1x1) that owns the value. Playwright's fill() refuses
 * to act on it, so focus the control and send real key events instead — that
 * drives the same onChangeText the user's keyboard would.
 */
async function enterPin(page: Page, pin: string) {
  const input = page.getByLabel('Trip PIN');
  await input.focus();
  await page.keyboard.type(pin, { delay: 30 });
}

/**
 * The app-wide transaction-PIN gate (AuthGate in app/_layout.tsx). Every other
 * e2e spec seeds a PIN so it can get past this screen; these tests are the ones
 * that deliberately do not, so the gate keeps coverage.
 */
test.describe('Auth E2E - Transaction PIN gate', () => {
  test('signed-in user without a PIN is held on the set-PIN screen', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page, undefined, { withPin: false });

    await expect(page.getByText('Create your transaction PIN')).toBeVisible();
    await expect(page.getByText('Setting a transaction PIN is required to continue.')).toBeVisible();
    // The gate is blocking: home must not have rendered behind it.
    await expect(page.getByText('Explore Services')).toBeHidden();
  });

  test('the gate is blocking — navigating away returns to set-PIN', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page, undefined, { withPin: false });
    await expect(page.getByText('Create your transaction PIN')).toBeVisible();

    await page.goto('/home', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Create your transaction PIN')).toBeVisible();
    await expect(page.getByText('Explore Services')).toBeHidden();
  });

  test('setting a 4-digit PIN clears the gate and lands on home', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page, undefined, { withPin: false });
    await expect(page.getByText('Create your transaction PIN')).toBeVisible();

    // Enter the new PIN, then confirm it. createPin() persists to the mock store,
    // and finish() primes the pin-status cache so the gate opens without a bounce.
    await enterPin(page, TEST_TXN_PIN);
    await page.getByText('Continue', { exact: true }).click();

    await expect(page.getByText('Confirm your PIN')).toBeVisible();
    await enterPin(page, TEST_TXN_PIN);
    await page.getByText('Set PIN', { exact: true }).click();

    await expect(page.getByText('Explore Services')).toBeVisible();
  });

  test('mismatched confirmation restarts the flow and does not set a PIN', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page, undefined, { withPin: false });
    await expect(page.getByText('Create your transaction PIN')).toBeVisible();

    await enterPin(page, '1234');
    await page.getByText('Continue', { exact: true }).click();
    await expect(page.getByText('Confirm your PIN')).toBeVisible();

    await enterPin(page, '9999');
    await page.getByText('Set PIN', { exact: true }).click();

    await expect(page.getByText('PINs do not match. Start again.')).toBeVisible();
    // Back to the first step, still gated — no PIN was set.
    await expect(page.getByText('Create your transaction PIN')).toBeVisible();
    await expect(page.getByText('Explore Services')).toBeHidden();
  });

  test('a user who already has a PIN is never shown the gate', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await mockPinStatus(page, true);
    await loginAs(page);

    await expect(page.getByText('Explore Services')).toBeVisible();
    await expect(page.getByText('Create your transaction PIN')).toBeHidden();
  });
});

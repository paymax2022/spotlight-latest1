import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';
import { users } from '../helpers/testData';

/**
 * The landing page's hero card, built to the wallet-card design concept: the
 * gradient panel with Total Balance + hide/show, the NGN|USD switch, the
 * receive control and the four action tiles. What this suite holds the screen
 * to is that every control on the card DOES something — a pill that only looks
 * tappable and a QR badge that goes nowhere are the failures that made the
 * concept a mock-up instead of a feature.
 *
 * Where the two figures come from:
 *   NGN — the dashboard wallet read (mockWallet seeds users.funded's
 *         ₦150,000.00; that is the KYC-gated primary the rest of the wallet
 *         screens agree with, so the card must not re-derive it).
 *   USD — the FX balances read. This lane blocks the repo .env and
 *         EXPO_PUBLIC_FX_USE_MOCK defaults to fixture mode, so the pot is
 *         MOCK_BALANCES' USD entry: 342000 kobo = $3,420.00.
 */
const NGN_TEXT = '₦150,000.00';
const USD_TEXT = '$3,420.00';

async function openHomeCard(page: Page) {
  await mockAmbientRequests(page);
  await mockWallet(page, users.funded.walletBalance);
  // The four tiles are registry-gated wallet sub-actions, not service modules
  // (see QUICK_ACTION_REGISTRY_KEY), so publish exactly those keys — otherwise
  // a hidden module would silently remove a tile this suite is about to tap.
  await mockModuleVisibility(page, [
    'wallet', 'walletTransfers', 'walletBankTransfers', 'fx',
  ]);
  await loginAs(page);
}

test.describe('Landing hero card — wallet concept', () => {
  test('renders the naira balance and hides it on demand', async ({ page }) => {
    await openHomeCard(page);

    await expect(page.getByText('Total Balance')).toBeVisible();
    await expect(page.getByText(NGN_TEXT)).toBeVisible();

    await page.getByRole('button', { name: 'Hide balance' }).click();
    await expect(page.getByText('••••••')).toBeVisible();
    await expect(page.getByText(NGN_TEXT)).toBeHidden();

    await page.getByRole('button', { name: 'Show balance' }).click();
    await expect(page.getByText(NGN_TEXT)).toBeVisible();
  });

  test('the NGN|USD pill switches to the real USD wallet', async ({ page }) => {
    await openHomeCard(page);

    // The switch is proved by the figure it changes to, not by an ARIA state:
    // react-native-web 0.21 does not emit aria-selected for a Pressable with
    // role="tab", so the selected pot is only observable through what the card
    // actually shows. $3,420.00 is the USD pot held in USD — not the naira
    // balance converted in the browser, which is what a decorative pill would
    // have shown.
    await expect(page.getByText(NGN_TEXT)).toBeVisible();

    await page.getByRole('tab', { name: 'Show USD wallet' }).click();
    await expect(page.getByText(USD_TEXT)).toBeVisible();
    await expect(page.getByText(NGN_TEXT)).toBeHidden();

    await page.getByRole('tab', { name: 'Show NGN wallet' }).click();
    await expect(page.getByText(NGN_TEXT)).toBeVisible();
    await expect(page.getByText(USD_TEXT)).toBeHidden();
  });

  test('the figure is not a fabricated zero while the wallet read is in flight', async ({ page }) => {
    await mockAmbientRequests(page);
    await mockWallet(page, users.funded.walletBalance);
    await mockModuleVisibility(page, [
      'wallet', 'walletTransfers', 'walletBankTransfers', 'fx',
    ]);
    // Registered last so it wins: hold up only the wallet read behind the
    // dashboard, which catches the card in its pending state — the moment it
    // used to print ₦0.00 for a user who has money.
    await page.route('**/api/v1/wallet/balance**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.fallback();
    });
    await loginAs(page);

    await expect(page.getByText('Total Balance')).toBeVisible();
    await expect(page.getByText('——')).toBeVisible();
    await expect(page.getByText(NGN_TEXT)).toBeHidden();

    // The placeholder is temporary, not a dead end: the real figure lands as
    // soon as the read returns.
    await expect(page.getByText(NGN_TEXT)).toBeVisible({ timeout: 25_000 });
  });

  test('the QR control opens the receive screen', async ({ page }) => {
    await openHomeCard(page);

    await page.getByRole('button', { name: 'Receive money' }).click();
    await expect(page).toHaveURL(/\/fx\/receive$/);
    await expect(page.getByText('Collect money into your wallets')).toBeVisible();
  });

  test('all four action tiles navigate to their screens', async ({ page }) => {
    await openHomeCard(page);

    const tiles: Array<[string, RegExp]> = [
      ['Add Money', /\/wallet\/add$/],
      ['Send', /\/wallet\/send$/],
      ['Withdraw', /\/wallet\/withdraw$/],
      ['Exchange', /\/fx$/],
    ];

    for (const [label, url] of tiles) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page).toHaveURL(url, { timeout: 20_000 });

      await page.goBack();
      await expect(page.getByPlaceholder('Find a service')).toBeVisible({ timeout: 20_000 });
    }
  });
});

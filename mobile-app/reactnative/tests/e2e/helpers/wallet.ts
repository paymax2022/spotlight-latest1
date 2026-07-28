import { Page } from '@playwright/test';
import { users } from './testData';

export async function mockWallet(page: Page, balance: number = users.funded.walletBalance) {
  await page.route('**/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user: { fullName: users.funded.fullName, phone: users.funded.phone },
          wallet: { balance, currency: 'NGN', ledgerBalance: balance, pendingBalance: 0 },
          services: { airtime: true, data: true, electricity: true, cableTv: true },
          recentTransactions: [],
          banners: [],
        },
      }),
    });
  });

  await page.route('**/wallet', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { balance, currency: 'NGN', ledgerBalance: balance, pendingBalance: 0 } }),
    });
  });

  await page.route('**/api/v1/wallet/balance', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { balance, currency: 'NGN', ledgerBalance: balance, pendingBalance: 0 } }),
    });
  });

  await page.route('**/wallet/transactions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { items: [], total: 0, page: 1, limit: 20, hasMore: false } }),
    });
  });
}

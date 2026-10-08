import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Profile module — there is no /profile index; the module's hub is the
 * Business Registry screen at /profile/business. The business API has no
 * mock layer (live `/api/finance/business` only), so GET /me is stubbed
 * per test.
 */
async function mockBusinesses(page: Page, businesses: unknown[]) {
  await page.route('**/api/finance/business/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: businesses }),
    });
  });
}

const SEEDED = [
  {
    id: 'biz_1',
    entityType: 'company',
    mode: 'verify_existing',
    legalName: 'Adaeze Ventures Ltd',
    status: 'registered',
    rcOrBnNumber: 'RC 1234567',
    proprietors: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  },
  {
    id: 'biz_2',
    entityType: 'business_name',
    mode: 'register_new',
    proposedName: 'Ngozi Foods',
    status: 'under_review',
    proprietors: [],
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
  },
];

test.describe('Profile E2E - business hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
  });

  test('lists the seeded businesses with their status chips', async ({ page }) => {
    await mockBusinesses(page, SEEDED);
    await loginAs(page);

    await page.goto('/profile/business');

    await expect(page.getByText('Business / Merchant')).toBeVisible();
    await expect(page.getByText('Your businesses')).toBeVisible();
    await expect(page.getByText('Adaeze Ventures Ltd')).toBeVisible();
    await expect(page.getByText('Limited company · RC 1234567')).toBeVisible();
    await expect(page.getByText('Registered', { exact: true })).toBeVisible();
    await expect(page.getByText('Ngozi Foods')).toBeVisible();
    await expect(page.getByText('Under review')).toBeVisible();
  });

  test('an empty registry shows the get-started CTAs', async ({ page }) => {
    await mockBusinesses(page, []);
    await loginAs(page);

    await page.goto('/profile/business');

    await expect(page.getByText("You don't have any businesses yet.")).toBeVisible();
    await expect(page.getByText('Get started', { exact: true })).toBeVisible();
    await expect(page.getByText('Verify existing business')).toBeVisible();
    await expect(page.getByText('Register a new business name', { exact: true })).toBeVisible();
  });
});

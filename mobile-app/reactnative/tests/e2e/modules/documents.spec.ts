import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Documents hub (estate document vault). The feature ships an in-app mock
 * layer (EXPO_PUBLIC_DOCUMENTS_USE_MOCK defaults true), so the list renders
 * with no endpoint mocks — items come from the seeded list in
 * src/features/documents/api.ts.
 */
test.describe('Documents E2E - document vault', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with seeded documents', async ({ page }) => {
    await page.goto('/documents');

    await expect(page.getByText('Documents', { exact: true })).toBeVisible();
    await expect(page.getByText('Estate Bye-laws (2026)')).toBeVisible();
    await expect(page.getByText('Q1 Financial Report')).toBeVisible();
    await expect(page.getByText('AGM Minutes — March')).toBeVisible();
    // The finance report is flagged restricted in the seed.
    await expect(page.getByText('Restricted')).toBeVisible();
  });

  test('category chip filters the list', async ({ page }) => {
    await page.goto('/documents');

    await page.getByText('Finance', { exact: true }).click();
    await expect(page.getByText('Q1 Financial Report')).toBeVisible();
    await expect(page.getByText('Estate Bye-laws (2026)')).not.toBeVisible();
  });
});

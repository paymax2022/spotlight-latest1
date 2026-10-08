import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Learn hub (Invest · Learn Center). The feature ships an in-app mock layer
 * (EXPO_PUBLIC_LEARN_USE_MOCK defaults true), so paths render with no endpoint
 * mocks — titles come from learn.mock.ts (Investing basics, Crypto
 * fundamentals, Spotlight Wealth, …).
 */
test.describe('Learn E2E - learning hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the hub with the hero and seeded learning paths', async ({ page }) => {
    await page.goto('/learn');

    await expect(page.getByText('Build your investing know-how')).toBeVisible();
    await expect(page.getByText('Invest with confidence')).toBeVisible();
    // "Investing basics" is 33% complete, so it also heads Continue learning —
    // the title renders twice; first() covers both copies.
    await expect(page.getByText('Continue learning')).toBeVisible();
    await expect(page.getByText('Investing basics').first()).toBeVisible();
    await expect(page.getByText('Crypto fundamentals').first()).toBeVisible();
    await expect(page.getByText('Spotlight Wealth').first()).toBeVisible();
  });

  test('glossary entry opens the glossary screen', async ({ page }) => {
    await page.goto('/learn');

    await page.getByText('Investing glossary').click();
    await expect(page).toHaveURL(/\/learn\/glossary/);
    await expect(page.getByText('Investing terms, in plain English')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * AI Notes hub (estate meeting summaries). EXPO_PUBLIC_AINOTES_USE_MOCK
 * defaults true — src/features/ainotes/api.ts seeds one complete note
 * ("Q2 General Meeting" with action items), so no endpoint mocks are needed
 * beyond the ambient stubs.
 */
test.describe('AI Notes E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the seeded meeting summary card', async ({ page }) => {
    await page.goto('/ai-notes');

    await expect(page.getByText('AI Notes', { exact: true })).toBeVisible();
    await expect(page.getByText('Meeting summaries')).toBeVisible();
    await expect(page.getByText('Q2 General Meeting')).toBeVisible();
    // Status chip + first seeded action items.
    await expect(page.getByText('Complete')).toBeVisible();
    await expect(page.getByText(/Finalise generator vendor contract/)).toBeVisible();
    await expect(page.getByText(/Recruit two additional night guards/)).toBeVisible();
  });

  test('tapping a note opens its detail screen', async ({ page }) => {
    await page.goto('/ai-notes');

    await page.getByText('Q2 General Meeting').click();
    await expect(page).toHaveURL(/\/ai-notes\/n1/);
    // Unique to the detail screen (the list stays mounted-but-hidden).
    await expect(page.getByText('Approve notes')).toBeVisible();
    await expect(page.getByText('Approve ₦7,500 service-charge increase')).toBeVisible();
  });
});

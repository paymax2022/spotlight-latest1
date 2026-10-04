import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Estate Tasks hub. EXPO_PUBLIC_TASKS_USE_MOCK defaults true — the seeded
 * board lives in features/tasks/api.ts ('Circulate Q3 meeting agenda' todo,
 * 'Replace Gate B intercom' in progress, 'Audit waste-disposal invoices'
 * done), so no endpoint mocks are needed beyond the ambient stubs.
 */
test.describe('Tasks E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the board with the status tabs and the to-do task', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.getByText('Tasks', { exact: true })).toBeVisible();
    await expect(page.getByText('To do', { exact: true })).toBeVisible();
    await expect(page.getByText('In progress', { exact: true })).toBeVisible();
    await expect(page.getByText('Done', { exact: true })).toBeVisible();

    // Default tab is 'todo' — the seeded medium-priority task must appear.
    await expect(page.getByText('Circulate Q3 meeting agenda')).toBeVisible();
    await expect(page.getByText('Ngozi Okeke')).toBeVisible();
  });

  test('switching tabs filters the seeded tasks', async ({ page }) => {
    await page.goto('/tasks');

    await expect(page.getByText('Circulate Q3 meeting agenda')).toBeVisible();

    await page.getByText('In progress', { exact: true }).click();
    await expect(page.getByText('Replace Gate B intercom')).toBeVisible();
    await expect(page.getByText('Circulate Q3 meeting agenda')).not.toBeVisible();

    await page.getByText('Done', { exact: true }).click();
    await expect(page.getByText('Audit waste-disposal invoices')).toBeVisible();
  });
});

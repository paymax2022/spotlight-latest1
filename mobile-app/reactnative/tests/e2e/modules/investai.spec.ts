import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';

/**
 * Invest AI hub — the education assistant intro. The screen is static
 * (capability lists + SUGGESTED_QUESTIONS chips), so no endpoint mocks are
 * needed beyond the ambient stubs. The chat only calls the assistant API
 * once a question is sent.
 */
test.describe('Invest AI E2E - hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    await loginAs(page);
  });

  test('renders the intro with capabilities and suggested questions', async ({ page }) => {
    await page.goto('/invest-ai');

    await expect(page.getByText('Invest AI', { exact: true })).toBeVisible();
    await expect(page.getByText('Your investing education assistant')).toBeVisible();
    await expect(page.getByText('What it can do')).toBeVisible();
    await expect(page.getByText("What it won't do")).toBeVisible();
    // Suggested-question chips from SUGGESTED_QUESTIONS.
    await expect(page.getByText('What is a stock?')).toBeVisible();
    await expect(page.getByText('What does volatility mean?')).toBeVisible();
    await expect(page.getByText('Educational only — not financial advice.')).toBeVisible();
  });

  test('Start chat opens the assistant empty state', async ({ page }) => {
    await page.goto('/invest-ai');

    await page.getByText('Start chat').click();
    await expect(page).toHaveURL(/\/invest-ai\/chat/);
    // Unique to the chat screen (the intro stays mounted-but-hidden).
    await expect(page.getByText('Ask me about investing')).toBeVisible();
  });
});

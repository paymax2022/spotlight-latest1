import { expect, Page } from '@playwright/test';

export async function expectText(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

export async function expectOnReceipt(page: Page, status: string | RegExp, reference: string | RegExp) {
  await expect(page.getByText(status).first()).toBeVisible();
  await expect(page.getByText(reference).first()).toBeVisible();
}

export async function expectNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
}

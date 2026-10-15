/**
 * AUTH-003 — forgot/reset password through the real UI, by emailed ONE-TIME CODE.
 *
 * Runs against a user this spec provisions itself — NEVER a fixture account
 * (resetting a fixture password invalidates every other session; repo rule).
 *
 * Journey: /forgot-password → enter email → Mailpit captures the code email →
 * code entered and VALIDATED (new-password form appears only after) → new password
 * + confirm → redirected to /login → old password fails, new one signs in.
 * There is no reset link in this flow.
 */

import { expect, test } from '@playwright/test';
import { extractOtpCode, provisionVerifiedUser, waitForEmail } from './helpers';

const NEW_PASSWORD = 'E2eResetPass!77';

test.describe('AUTH-003: forgot → reset password (OTP)', () => {
  test('request code, validate it, set a new password, land on login', async ({
    page,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'e2e-reset');

    await test.step('request is answered and the code step appears', async () => {
      await page.goto('/forgot-password');
      const forgotResponse = page.waitForResponse((r) =>
        r.url().includes('/api/auth/forgot-password'),
      );
      await page.locator('#forgot-password-identifier').fill(user.email);
      await page.getByRole('button', { name: /send reset code/i }).click();
      expect((await forgotResponse).status()).toBe(200);
      await expect(page.locator('input[inputmode="numeric"]').first()).toBeVisible();
      // The new-password form must NOT be reachable before the code is validated.
      await expect(page.locator('#forgot-password-new')).toHaveCount(0);
    });

    const code = await test.step('code email captured', async () => {
      const msg = await waitForEmail(request, user.email, { timeoutMs: 45_000 });
      expect(msg, 'no reset email reached Mailpit').toBeTruthy();
      const c = extractOtpCode(msg!);
      expect(c, 'reset email carried no code').toBeTruthy();
      return c!;
    });

    await test.step('a wrong code is rejected and keeps the password form hidden', async () => {
      const wrong = code.replace(/\d$/, (d) => String((Number(d) + 1) % 10));
      await page.locator('input[inputmode="numeric"]').first().fill(wrong);
      await page.getByRole('button', { name: /verify code/i }).click();
      await expect(page.getByText(/not correct|expired/i)).toBeVisible();
      await expect(page.locator('#forgot-password-new')).toHaveCount(0);
    });

    await test.step('the correct code opens the new-password form', async () => {
      // The wrong attempt above spends one try; the code itself is still valid.
      await page.locator('input[inputmode="numeric"]').first().fill(code);
      await page.getByRole('button', { name: /verify code/i }).click();
      await expect(page.locator('#forgot-password-new')).toBeVisible({ timeout: 15_000 });
    });

    await test.step('new password + confirm updates and routes to login', async () => {
      await page.locator('#forgot-password-new').fill(NEW_PASSWORD);
      await page.locator('#forgot-password-confirm').fill(NEW_PASSWORD);
      await page.getByRole('button', { name: /update password/i }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });

    await test.step('old password fails, new password signs in', async () => {
      const oldLogin = await request.post('/api/auth/login', {
        data: { identifier: user.email, password: user.password },
      });
      expect(oldLogin.status()).toBe(401);
      const newLogin = await request.post('/api/auth/login', {
        data: { identifier: user.email, password: NEW_PASSWORD },
      });
      expect(newLogin.ok()).toBeTruthy();
    });
  });
});

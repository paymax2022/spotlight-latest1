/**
 * AUTH-002 — register → email verify → login, through the real product.
 *
 * Journey under test:
 *   /login "Create Account" tab → POST /api/auth/register → redirect to
 *   /verify-email → 6-digit code read out of Mailpit → POST /api/auth/verify-otp
 *   → landing page → sign in with the new credentials → user-dashboard.
 *
 * Every /api/auth/* response the browser sees is recorded so the results file
 * can cite real status codes, not guesses.
 */

import { expect, test } from '@playwright/test';
import { extractOtpCode, uniqueEmail, waitForEmail } from './helpers';
import { PROTECTED_ROUTE, TEST_USER, loginViaUi } from '../helpers/auth';

interface SeenResponse {
  url: string;
  status: number;
}

function recordAuthTraffic(page: import('@playwright/test').Page, sink: SeenResponse[]) {
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/auth/') || url.includes('/auth/v1/')) {
      sink.push({ url, status: res.status() });
    }
  });
}

test.describe('AUTH-002: register → verify → login', () => {
  test('new user registers through the UI, verifies the emailed code, signs in', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('e2e-reg');
    const password = 'E2eRegister!9x';
    const seen: SeenResponse[] = [];
    let verifySignedIn = false;
    recordAuthTraffic(page, seen);

    await test.step('register via the Create Account tab on /login', async () => {
      await page.goto('/login');
      await page.getByRole('button', { name: /create account/i }).click();
      await page.getByPlaceholder(/jane smith/i).fill('E2E Register Tester');
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);

      const registerResponse = page.waitForResponse((r) => r.url().includes('/api/auth/register'));
      await page.locator('form button[type="submit"]').click();
      const reg = await registerResponse;
      expect([200, 201]).toContain(reg.status());

      await page.waitForURL('**/verify-email**', { timeout: 20_000 });
      expect(page.url()).toContain(`email=${encodeURIComponent(email)}`);
    });

    await test.step('verification code arrives in Mailpit', async () => {
      const msg = await waitForEmail(request, email, { timeoutMs: 45_000 });
      expect(msg, 'no verification email reached Mailpit').toBeTruthy();
      const code = extractOtpCode(msg!);
      expect(code, 'verification email carried no 6-digit code').toBeTruthy();
      test.info().annotations.push({ type: 'mail', description: msg!.subject });

      // Enter the code — pasting/filling the whole code into box 1 is the
      // supported path (distributeOtpInput spreads it across the boxes).
      const verifyResponse = page.waitForResponse((r) => r.url().includes('/api/auth/verify-otp'));
      await page.locator('input[inputmode="numeric"]').first().fill(code!);
      await page.getByRole('button', { name: /verify email/i }).click();
      const verify = await verifyResponse;
      expect(verify.status()).toBe(200);
      const verifyBody = (await verify.json()) as { signedIn?: boolean };
      verifySignedIn = verifyBody?.signedIn === true;
      console.log('[AUTH-002 verify-otp]', verify.status(), 'signedIn=', verifyBody?.signedIn);
      test.info().annotations.push({
        type: 'verify-otp',
        description: `status=${verify.status()} signedIn=${verifyBody?.signedIn}`,
      });
    });

    await test.step('post-verify landing', async () => {
      // The verify page routes to `next` (/user-dashboard) when the verifier
      // reports a live session, else to /login. Whichever it is, record it.
      await page.waitForURL((u) => !u.toString().includes('verify-email'), { timeout: 20_000 });
      const landed = page.url();
      console.log('[AUTH-002 landing]', landed);
      test.info().annotations.push({ type: 'landing', description: landed });
      if (verifySignedIn) {
        // signedIn:true means a session was minted — the page adopts it via
        // setSession before navigating, so bouncing to /login?next= means the
        // session was dropped again (E2E-AUTH-009).
        expect(landed).toContain(PROTECTED_ROUTE);
        expect(landed).not.toContain('/login');
        await expect(page.getByText(/welcome back/i)).toBeVisible();
      }
    });

    await test.step('sign in with the brand-new credentials', async () => {
      // Independent of where the verify step landed: a fresh login with the
      // registered credentials must reach the dashboard.
      await loginViaUi(page, request, { email, password });
      await expect(page).toHaveURL(new RegExp(PROTECTED_ROUTE));
    });

    // Surface everything the browser saw for the results write-up.
    console.log('[AUTH-002 traffic]', JSON.stringify(seen, null, 0));
  });
});

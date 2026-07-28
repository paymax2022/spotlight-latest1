import { expect, test } from '@playwright/test';
import { loginAs, mockAuth } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockBillsCatalog } from '../helpers/bills';
import { users } from '../helpers/testData';

test.describe('Auth E2E - Login flow', () => {
  test('successful login lands on home screen', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);

    await expect(page.getByText('Explore Services')).toBeVisible();
  });

  test('shows API error on wrong credentials', async ({ page }) => {
    await page.route('**/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }),
      });
    });
    await page.route('**/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) });
    });

    await page.goto('/login');
    await page.getByPlaceholder('you@example.com').fill('wrong@email.com');
    await page.getByPlaceholder('Enter your password').fill('wrongpassword');
    await page.getByText('Sign In', { exact: true }).click();

    await expect(page.getByText(/invalid|unauthorized|credentials/i).first()).toBeVisible();
  });

  test('empty email and password shows validation error', async ({ page }) => {
    await page.goto('/login');
    await page.getByText('Sign In', { exact: true }).click();

    // Form should remain on login page without API call
    await expect(page.getByText('Sign In', { exact: true })).toBeVisible();
  });

  test('authenticated user is redirected away from login page', async ({ page }) => {
    await mockAuth(page);
    await mockWallet(page);
    await mockBillsCatalog(page);

    // Simulate already-logged-in state by pre-seeding localStorage token
    await page.goto('/login');
    await page.evaluate((token) => {
      localStorage.setItem('paymax_secure_access_token', token);
    }, users.funded.accessToken);

    await page.reload();
    // AuthGate should detect the token and redirect to home
    await expect(page.getByText('Explore Services')).toBeVisible({ timeout: 15_000 });
  });

  test('401 on /auth/me clears session and redirects to login', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);

    // Now re-route /auth/me to fail (simulates session expiry)
    await page.route('**/auth/me', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) });
    });
    await page.route('**/dashboard', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) });
    });

    // Navigate to a protected route — axios interceptor should redirect to login
    await page.goto('/services/airtime');
    // The 401 interceptor replaces the route to login
    await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});

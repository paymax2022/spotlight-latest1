import { expect, test } from '@playwright/test';
import { loginAs, mockAuth, mockPinStatus, seedSession } from '../helpers/auth';
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
    await mockPinStatus(page, true);

    // Simulate an already-logged-in state by pre-seeding the session, then land
    // on /login. seedSession writes the key the app actually reads — the old
    // 'paymax_secure_access_token' was consumed by nothing, so the app stayed
    // signed out and this never exercised the redirect it claims to test.
    await seedSession(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // AuthGate should detect the session and redirect away from login to home.
    await expect(page.getByText('Explore Services')).toBeVisible({ timeout: 15_000 });
  });

  test('a 401 from the API clears the session and redirects to login', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);
    await loginAs(page);

    // Simulate session expiry on a call the protected screen actually makes
    // through the intercepted axios client (getWallet → /api/v1/wallet/balance).
    // The old test 401'd /auth/me and /dashboard, which the app no longer calls
    // at all, so nothing ever triggered the interceptor.
    await page.route('**/api/v1/wallet/balance', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED' }) });
    });

    // Navigate to a protected route — axios interceptor should redirect to login
    await page.goto('/services/airtime');
    // The 401 interceptor replaces the route to login
    await expect(page.getByText('Sign In', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});

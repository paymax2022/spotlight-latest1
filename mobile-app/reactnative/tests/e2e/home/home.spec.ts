import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockWallet } from '../helpers/wallet';
import { mockBillsCatalog } from '../helpers/bills';

test.describe('Home screen', () => {
  test('opens the app, lands on home, and shows the main heading', async ({ page }) => {
    await mockWallet(page);
    await mockBillsCatalog(page);

    // loginAs signs a funded/PIN'd test user in and navigates to /home itself —
    // mirrors tests/e2e/auth/login.spec.ts's "successful login lands on home
    // screen" case, which is the existing convention for "the app is open and
    // on home" rather than a bare page.goto('/home') against a signed-out gate.
    await loginAs(page);

    // "Explore Services" is the home screen's SectionHeader — see
    // app/(tabs)/home.tsx — and is the same element every other e2e spec in
    // this suite already treats as proof home rendered.
    await expect(page.getByText('Explore Services')).toBeVisible();
  });
});

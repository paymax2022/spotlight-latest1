import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Arena hub (Naija Driver Challenge). EXPO_PUBLIC_ARENA_USE_MOCK defaults
 * true — the competition, Merit leaderboard (NDC-1) and rails all come from
 * reads.mock.ts (Chidinma Okafor · Lagos, Musa Ibrahim · Kano, …), so no
 * endpoint mocks are needed beyond the ambient stubs. The /arena route is
 * deliberately not registry-gated (routeModuleKeys.ts).
 */
test.describe('Arena E2E - competition hub', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('renders the live competition, merit leaderboard and rail grid', async ({ page }) => {
    await page.goto('/arena');

    await expect(page.getByText('Naija Driver Challenge 2026')).toBeVisible();
    await expect(page.getByText('Enter the Challenge')).toBeVisible();
    await expect(page.getByText('Merit leaderboard')).toBeVisible();
    // Seeded leaderboard — the real NDC-1 ranking, decided by scores.
    await expect(page.getByText('Chidinma Okafor')).toBeVisible();
    await expect(page.getByText('Musa Ibrahim')).toBeVisible();
    // Rail grid entry points.
    await expect(page.getByText('State Pride')).toBeVisible();
    await expect(page.getByText('Predict the Champion')).toBeVisible();
    await expect(page.getByText('Prize Pot')).toBeVisible();
  });

  test('Prize Pot rail opens the transparency screen', async ({ page }) => {
    await page.goto('/arena');

    await expect(page.getByText('Prize Pot')).toBeVisible();
    await page.getByText('Prize Pot').click();
    await expect(page).toHaveURL(/\/arena\/pot/);
    // Unique to the pot screen — the hub stays mounted-but-hidden under it.
    await expect(page.getByText('Split formula')).toBeVisible();
    await expect(page.getByText('Naija Driver crown prize')).toBeVisible();
  });
});

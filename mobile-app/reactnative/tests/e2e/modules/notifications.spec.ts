import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests } from '../helpers/common';
import { mockWallet } from '../helpers/wallet';

/**
 * Notifications. Two surfaces:
 *   • /notifications — collides between (tabs)/notifications.tsx and
 *     (doctor)/notifications.tsx; the (doctor) group wins route resolution,
 *     so the URL lands on the seeded clinical notification centre
 *     (useNotificationFeed — doctor mock layer).
 *   • /estate-notifications — the estate notification centre; backed by
 *     src/features/notifications (EXPO_PUBLIC_NOTIFICATIONS_USE_MOCK defaults
 *     true) with seeded items (service charge, security alert, …).
 * Neither route is registry-gated.
 */
test.describe('Notifications E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockAmbientRequests(page);
    // loginAs lands on /home, whose dashboard fires /api/v1/wallet/balance —
    // a live 401 there signs the session out mid-test. Pin it.
    await mockWallet(page);
    await loginAs(page);
  });

  test('/notifications renders the seeded notification centre', async ({ page }) => {
    await page.goto('/notifications');

    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
    await expect(page.getByText('Mark all read')).toBeVisible();
    // Filter chip AND the grouped-section label both render "Appointments".
    await expect(page.getByText('Appointments', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Tunde Akinwale booked a video consult/)).toBeVisible();
  });

  test('estate notification centre lists seeded alerts', async ({ page }) => {
    await page.goto('/estate-notifications');

    await expect(page.getByText('Notifications', { exact: true })).toBeVisible();
    await expect(page.getByText('Service charge due in 7 days')).toBeVisible();
    await expect(page.getByText('Security alert resolved')).toBeVisible();
    await expect(page.getByText('Q3 General Meeting scheduled')).toBeVisible();
    await expect(page.getByText('Water supply maintenance')).toBeVisible();
  });
});

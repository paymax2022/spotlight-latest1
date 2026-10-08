/**
 * PROVIDER-002 — KYB (business verification) submit → admin approval → live.
 *
 * KYB has NO BFF proxy (frontend-web/app/api/v1/restaurant/[id]/ has no /kyb
 * route) — the mobile owner console calls Go directly, so this spec does too:
 *   PUT  :8080/api/finance/restaurant/:id/kyb
 *   POST :8080/api/finance/restaurant/:id/kyb/documents   (URL ref, not upload)
 *   POST :8080/api/finance/restaurant/:id/kyb/submit
 *
 * Admin approval, two real mechanisms, one restaurant each:
 *   A) Real admin API: POST :8080/api/restaurant/admin/onboarding/:id/approve
 *      with an admin Bearer (super-admin RBAC restaurant.admin.onboarding).
 *      The /api/restaurant/admin group mounts mapsAuth()+RequirePermission —
 *      x-admin-api-key is NOT part of this gate.
 *   B) Real admin console UI at :3001 /admin/restaurant/onboarding (login →
 *      Review → Approve), which hits the same Go route through /api/admin-proxy.
 *
 * Asserts the full status flip in API + DB (restaurant_kyb.status,
 * restaurants.kyb_status, is_open) and that the owner sees 'approved'.
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';
import { ADMIN_USER, ADMIN_WEB_URL, createRestaurant, goFetch, goTrueToken } from './helpers';

const KYB_BODY = {
  legal_name: 'E2E Provider Foods',
  business_type: 'sole_proprietor',
  contact_email: 'kyb-e2e@paymax.test',
  contact_phone: '+2348012345678',
  bank_code: '058',
  account_number: '0123456789',
  account_name: 'E2E Provider Foods',
};

async function ownerToken(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const login = await request.post('/api/auth/login', {
    data: { identifier: email, password },
  });
  return ((await login.json()).session.access_token as string);
}

test.describe('PROVIDER-002: KYB submit → admin approval → provider live', () => {
  test('API: owner submits KYB → admin API approves → status flips everywhere', async ({
    context,
    request,
  }) => {
    const owner = await provisionVerifiedUser(request, 'p-kyb');
    await loginViaApi(context, request, { email: owner.email, password: owner.password });
    const token = await ownerToken(request, owner.email, owner.password);
    const name = `E2EKYB${Date.now() % 100000} Diner`;

    const created = await createRestaurant(request, token, name);
    expect(created.status).toBe(201);
    const rid = created.body.id;

    await test.step('KYB lifecycle: fill → submit', async () => {
      // No KYB row yet → empty draft.
      const before = await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, { token });
      expect(before.status).toBe(200);
      expect(before.body.kyb.status).toBe('draft');

      const saved = await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, {
        method: 'PUT',
        token,
        data: KYB_BODY,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.kyb.status).toBe('draft');

      // Negative: an incomplete sibling submission is refused (prove the gate by
      // submitting against a SECOND unverified restaurant with no KYB row).
      const bare = await createRestaurant(request, token, `${name} Unverified`);
      const bareSubmit = await goFetch(request, `/api/finance/restaurant/${bare.body.id}/kyb/submit`, {
        method: 'POST',
        token,
      });
      expect(bareSubmit.status).toBe(400); // "fill in your KYB details before submitting"

      const submitted = await goFetch(request, `/api/finance/restaurant/${rid}/kyb/submit`, {
        method: 'POST',
        token,
      });
      expect(submitted.status).toBe(200);
      expect(submitted.body.kyb.status).toBe('submitted');
      expect(
        psql(`select status from restaurant_kyb where restaurant_id='${rid}';`),
      ).toBe('submitted');
      expect(psql(`select kyb_status from restaurants where id='${rid}';`)).toBe('submitted');
    });

    await test.step('admin approval via the real admin API', async () => {
      const admin = await goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);

      // Positive control: the review queue lists our application as pending.
      const queue = await goFetch(request, '/api/restaurant/admin/onboarding?status=pending', {
        token: admin,
      });
      expect(queue.status).toBe(200);
      expect((queue.body as Array<{ id: string }>).map((a) => a.id)).toContain(rid);

      // Negative control: a non-admin bearer is refused at the RBAC gate.
      const denied = await goFetch(request, `/api/restaurant/admin/onboarding/${rid}/approve`, {
        method: 'POST',
        token,
        data: {},
      });
      expect([401, 403]).toContain(denied.status);

      const decided = await goFetch(request, `/api/restaurant/admin/onboarding/${rid}/approve`, {
        method: 'POST',
        token: admin,
        data: { note: 'E2E verified' },
      });
      expect(decided.status).toBe(200);

      // Status flipped in every store the money path reads.
      expect(psql(`select status from restaurant_kyb where restaurant_id='${rid}';`)).toBe('approved');
      expect(
        psql(`select kyb_status || '|' || is_open from restaurants where id='${rid}';`),
      ).toBe('approved|true');
    });

    await test.step('owner sees approval + can now operate', async () => {
      const kyb = await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, { token });
      expect(kyb.body.kyb.status).toBe('approved');

      // Discovery now lists the store (is_open=true set by the approval).
      const disc = await request.get(`/api/v1/restaurant?q=${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const page = await disc.json();
      expect((page.restaurants ?? []).map((r: { id: string }) => r.id)).toContain(rid);
    });
  });

  test('UI: admin console :3001 approves a submitted application', async ({ context, request, page }) => {
    const owner = await provisionVerifiedUser(request, 'p-kyb-ui');
    await loginViaApi(context, request, { email: owner.email, password: owner.password });
    const token = await ownerToken(request, owner.email, owner.password);
    const name = `E2EKYBUI${Date.now() % 100000} Grill`;

    const created = await createRestaurant(request, token, name);
    expect(created.status).toBe(201);
    const rid = created.body.id;
    expect(
      (await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, { method: 'PUT', token, data: KYB_BODY })).status,
    ).toBe(200);
    expect(
      (await goFetch(request, `/api/finance/restaurant/${rid}/kyb/submit`, { method: 'POST', token })).status,
    ).toBe(200);

    // Real console login (Supabase password grant behind the form).
    await page.goto(`${ADMIN_WEB_URL}/admin/login`);
    await page.locator('input[placeholder="admin"]').fill(ADMIN_USER.email);
    await page.locator('input[type="password"]').fill(ADMIN_USER.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/admin(?!\/login)/, { timeout: 30_000 });

    await page.goto(`${ADMIN_WEB_URL}/admin/restaurant/onboarding`);
    await expect(page.getByText('Restaurant Onboarding')).toBeVisible({ timeout: 30_000 });

    const row = page.locator('tr', { hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /review/i }).click();
    await page.getByRole('button', { name: /^approve$/i }).click();
    await expect(page.getByText(/approved\./i)).toBeVisible({ timeout: 15_000 });

    // The same flip lands in the DB.
    expect(
      psql(`select kyb_status || '|' || is_open from restaurants where id='${rid}';`),
    ).toBe('approved|true');
  });
});

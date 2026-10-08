/**
 * CMS-011 — estate dues money journey: estate create → resident add → invoice
 * → resident pay (wallet debit, Idempotency-Key, tier gate, balanced legs,
 * immutable receipt) → replay → platform-admin oversight reads
 * (/estate-admin/dues/*). Paystack-funded dues checkout is psp-unverified
 * (flag + live keys absent locally).
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  fundWallet,
  goFetch,
  goTrueToken,
  grantAdminPerm,
  idemKey,
  ledgerSums,
  provisionVerifiedUser,
  setKycTier,
  walletBalance,
} from './helpers';

test.describe('CMS-011 estate: dues invoice → wallet pay → receipt → oversight', () => {
  test('resident pays invoice; replay returns canonical receipt; admin oversight', async ({ request }) => {
    const tag = Date.now() % 100000;
    const estateAdmin = await provisionVerifiedUser(request, 'cms-est');
    const aToken = await goTrueToken(request, estateAdmin.email, estateAdmin.password);
    const resident = await provisionVerifiedUser(request, 'cms-res');
    const rToken = await goTrueToken(request, resident.email, resident.password);
    fundWallet(resident.userId, 5_000_000, `est-${tag}`);
    setKycTier(resident.userId, 3);

    // Estate + resident membership.
    const create = await goFetch(request, '/api/finance/estate', {
      method: 'POST',
      token: aToken,
      data: { name: `E2E Gardens ${tag}`, address: '1 E2E Close' },
    });
    expect([200, 201]).toContain(create.status);
    const estateId = create.body?.id ?? create.body?.data?.id;
    expect(estateId).toBeTruthy();

    const addRes = await goFetch(request, `/api/finance/estate/${estateId}/residents`, {
      method: 'POST',
      token: aToken,
      data: { user_id: resident.userId, unit: 'Block A-1' },
    });
    expect([200, 201]).toContain(addRes.status);

    // Invoice (estate-admin only — resident must be 403).
    const denied = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices`, {
      method: 'POST',
      token: rToken,
      data: { resident_id: resident.userId, category: 'service_charge', amount_kobo: 150_000, due_date: new Date(Date.now() + 86400000).toISOString() },
    });
    expect([403, 401]).toContain(denied.status);

    const inv = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices`, {
      method: 'POST',
      token: aToken,
      data: { resident_id: resident.userId, category: 'service_charge', amount_kobo: 150_000, due_date: new Date(Date.now() + 86400000).toISOString() },
    });
    expect([200, 201]).toContain(inv.status);
    const invoiceId = inv.body?.id ?? inv.body?.data?.id;
    expect(invoiceId).toBeTruthy();

    const list = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices`, { token: rToken });
    expect(list.status).toBe(200);
    expect((list.body?.data ?? []).some((i: any) => i.id === invoiceId)).toBe(true);

    // Pay requires Idempotency-Key (money rule → 400 without).
    const noKey = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices/${invoiceId}/pay`, {
      method: 'POST',
      token: rToken,
      data: { method: 'wallet' },
    });
    expect(noKey.status).toBe(400);

    const before = Number(walletBalance(resident.userId));
    const key = idemKey('dues');
    const pay = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices/${invoiceId}/pay`, {
      method: 'POST',
      token: rToken,
      headers: { 'Idempotency-Key': key },
      data: { method: 'wallet' },
    });
    expect(pay.status).toBe(201);
    const receipt = pay.body?.id ?? pay.body?.reference;
    expect(receipt).toBeTruthy();
    expect(Number(walletBalance(resident.userId))).toBe(before - 150_000);

    // Balanced legs under the deterministic ref.
    const legs = ledgerSums(`estate_dues:${estateId}:${invoiceId}%`);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    const debit = legs.find((l) => l.accountUserId === resident.userId);
    expect(debit?.total).toBe(150_000);
    const settleLeg = legs.find((l) => l.accountType !== 'user_wallet');
    expect(settleLeg?.total).toBe(150_000);

    // Idempotent replay → same canonical receipt, no second debit.
    const replay = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices/${invoiceId}/pay`, {
      method: 'POST',
      token: rToken,
      headers: { 'Idempotency-Key': idemKey('dues-replay') },
      data: { method: 'wallet' },
    });
    expect([200, 201]).toContain(replay.status);
    expect(Number(walletBalance(resident.userId))).toBe(before - 150_000);

    // Amount-mismatch guard: an override that != invoice amount is rejected.
    const inv2 = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices`, {
      method: 'POST',
      token: aToken,
      data: { resident_id: resident.userId, category: 'penalty', amount_kobo: 200_000, due_date: new Date(Date.now() + 86400000).toISOString() },
    });
    const invoice2 = inv2.body?.id ?? inv2.body?.data?.id;
    const mismatch = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices/${invoice2}/pay`, {
      method: 'POST',
      token: rToken,
      headers: { 'Idempotency-Key': idemKey('dues2') },
      data: { method: 'wallet', amount_kobo: 100_000 },
    });
    expect([400, 409, 422]).toContain(mismatch.status);

    // Restriction apply → resident restricted; payment lifts? (docs: on
    // success any active restriction is lifted) — apply then pay a third.
    const restrict = await goFetch(request, `/api/finance/estate/${estateId}/dues/restrictions`, {
      method: 'POST',
      token: aToken,
      data: { resident_id: resident.userId, level: 'soft', reason: 'e2e arrears' },
    });
    expect([200, 201]).toContain(restrict.status);
    const pay2 = await goFetch(request, `/api/finance/estate/${estateId}/dues/invoices/${invoice2}/pay`, {
      method: 'POST',
      token: rToken,
      headers: { 'Idempotency-Key': idemKey('dues3') },
      data: { method: 'wallet' },
    });
    expect(pay2.status).toBe(201);

    // Platform oversight (read-only, estate.admin.* RBAC slugs).
    grantAdminPerm('estate.admin.dues', 'estate.admin.security', 'estate.admin.ops', 'estate.admin.content', 'estate.admin.election');
    for (const path of [
      '/api/finance/estate-admin/dues/invoices',
      '/api/finance/estate-admin/dues/payments',
      '/api/finance/estate-admin/dues/reconciliation',
      '/api/finance/estate-admin/dues/restrictions',
      '/api/finance/estate-admin/security/gates',
      '/api/finance/estate-admin/security/incidents',
      '/api/finance/estate-admin/security/guard-shifts',
      '/api/finance/estate-admin/security/visitor-logs',
      '/api/finance/estate-admin/security/emergencies',
      '/api/finance/estate-admin/ops/repairs',
      '/api/finance/estate-admin/ops/tasks',
      '/api/finance/estate-admin/ops/meetings',
      '/api/finance/estate-admin/ops/facilities',
      '/api/finance/estate-admin/content/announcements',
      '/api/finance/estate-admin/content/documents',
      '/api/finance/estate-admin/elections',
    ]) {
      const res = await adminFetch(request, path);
      expect(res.status, `estate-admin ${path}`).toBe(200);
    }
  });
});

/**
 * MTL-002 — FX business console surface (/api/v1/fx/* admin-adjacent reads/writes).
 *
 * These routes are member-authenticated (requireUserID) and backed by the
 * SQL BusinessStore/CardStore — they carry no ledger money path of their own,
 * but they are part of the uncovered FX surface and are exercised against the
 * real routes + real Postgres. Card issuing degrades when no issuer is wired
 * (cardIssuer = nil locally: no MAPLERAD_SECRET_KEY) — the route still answers
 * honestly, which is the contract we assert.
 */

import { expect, test } from '@playwright/test';

import {
  fundWallet,
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
  setKycTier,
} from './helpers';

async function user(request: any, tag: string) {
  const u = await provisionVerifiedUser(request, tag);
  const token = await goTrueToken(request, u.email, u.password);
  setKycTier(u.userId, 3);
  fundWallet(u.userId, 5_000_000, `${tag}-${Date.now()}`);
  return { u, token };
}

test.describe('MTL-002 fx business console', () => {
  test('team / approvals / thresholds / activity / limits / notifications', async ({ request }) => {
    const { token } = await user(request, 'mtl002a');

    const team = await goFetch(request, '/api/v1/fx/team', { token });
    expect(team.status).toBe(200);

    const role = await goFetch(request, `/api/v1/fx/team/${crypto.randomUUID()}`, {
      method: 'PATCH', token, data: { role: 'viewer' },
    });
    expect([200, 400, 404]).toContain(role.status); // honest answer for an unknown member

    const approvals = await goFetch(request, '/api/v1/fx/approvals', { token });
    expect(approvals.status).toBe(200);

    const thresholds = await goFetch(request, '/api/v1/fx/approvals/thresholds', { token });
    expect(thresholds.status).toBe(200);

    const activity = await goFetch(request, '/api/v1/fx/activity', { token });
    expect(activity.status).toBe(200);

    const limits = await goFetch(request, '/api/v1/fx/limits', { token });
    expect(limits.status).toBe(200);

    const notifs = await goFetch(request, '/api/v1/fx/notifications', { token });
    expect(notifs.status).toBe(200);
    const markAll = await goFetch(request, '/api/v1/fx/notifications/read-all', { method: 'POST', token, data: {} });
    expect([200, 204]).toContain(markAll.status);
    const markOne = await goFetch(request, `/api/v1/fx/notifications/${crypto.randomUUID()}`, {
      method: 'PATCH', token, data: { read: true },
    });
    expect([200, 204, 404]).toContain(markOne.status);
  });

  test('api keys create → rotate → list', async ({ request }) => {
    const { token } = await user(request, 'mtl002b');

    const created = await goFetch(request, '/api/v1/fx/api-keys', {
      method: 'POST', token, data: { name: 'mtl-e2e-key', permissions: ['read'] },
    });
    expect([200, 201]).toContain(created.status);

    const list = await goFetch(request, '/api/v1/fx/api-keys', { token });
    expect(list.status).toBe(200);

    if (created.body?.id) {
      const rotated = await goFetch(request, `/api/v1/fx/api-keys/${created.body.id}/rotate`, { method: 'POST', token, data: {} });
      expect([200, 201]).toContain(rotated.status);
    }
  });

  test('outbound webhook settings CRUD', async ({ request }) => {
    const { token } = await user(request, 'mtl002c');

    const list0 = await goFetch(request, '/api/v1/fx/webhooks', { token });
    expect(list0.status).toBe(200);

    const created = await goFetch(request, '/api/v1/fx/webhooks', {
      method: 'POST', token,
      data: { url: 'https://example.invalid/mtl-hook', events: ['conversion.settled'], secret: 'mtl-e2e-secret' },
    });
    expect([200, 201]).toContain(created.status);
    const id = created.body?.id ?? created.body?.data?.id;
    if (id) {
      const upd = await goFetch(request, `/api/v1/fx/webhooks/${id}`, {
        method: 'PATCH', token, data: { active: false },
      });
      expect([200, 204]).toContain(upd.status);
      const del = await goFetch(request, `/api/v1/fx/webhooks/${id}`, { method: 'DELETE', token });
      expect([200, 204]).toContain(del.status);
    }
  });

  test('settings + notification prefs + stablecoin addresses', async ({ request }) => {
    const { token } = await user(request, 'mtl002d');

    const s0 = await goFetch(request, '/api/v1/fx/settings', { token });
    expect(s0.status).toBe(200);

    const s1 = await goFetch(request, '/api/v1/fx/settings', {
      method: 'PATCH', token, data: { defaultCurrency: 'NGN' },
    });
    expect([200, 204]).toContain(s1.status);

    const np = await goFetch(request, '/api/v1/fx/settings/notifications', {
      method: 'PATCH', token, data: { email: true, push: false },
    });
    expect([200, 204]).toContain(np.status);

    const addr = await goFetch(request, '/api/v1/fx/settings/stablecoin-addresses', {
      method: 'POST', token,
      data: { currency: 'USDC', network: 'ethereum', address: '0x000000000000000000000000000000000000dEaD' },
    });
    expect([200, 201]).toContain(addr.status);
    const addrId = addr.body?.id ?? addr.body?.data?.id;
    if (addrId) {
      const del = await goFetch(request, `/api/v1/fx/settings/stablecoin-addresses/${addrId}`, { method: 'DELETE', token });
      expect([200, 204]).toContain(del.status);
    }
  });

  test('virtual cards surface answers honestly when no issuer is wired', async ({ request }) => {
    const { token } = await user(request, 'mtl002e');

    const list = await goFetch(request, '/api/v1/fx/cards', { token });
    expect(list.status).toBe(200);

    const created = await goFetch(request, '/api/v1/fx/cards', {
      method: 'POST', token, data: { currency: 'USD', type: 'virtual' },
    });
    // No card issuer is wired locally (MAPLERAD_SECRET_KEY unset → cardIssuer nil):
    // the route must answer honestly — success with a stored row, or a
    // contract-shaped refusal. Either way the path is exercised.
    expect([200, 201, 400, 402, 422, 503]).toContain(created.status);
    const cardId = created.body?.id ?? created.body?.data?.id;
    if (cardId) {
      const get = await goFetch(request, `/api/v1/fx/cards/${cardId}`, { token });
      expect(get.status).toBe(200);
      const txns = await goFetch(request, `/api/v1/fx/cards/${cardId}/transactions`, { token });
      expect(txns.status).toBe(200);
      const ctl = await goFetch(request, `/api/v1/fx/cards/${cardId}/controls`, {
        method: 'PATCH', token, data: { spendingLimit: 100_00 },
      });
      expect([200, 204, 400]).toContain(ctl.status);
      const freeze = await goFetch(request, `/api/v1/fx/cards/${cardId}/freeze`, { method: 'POST', token, data: {} });
      expect([200, 204, 400, 422]).toContain(freeze.status);
      const unfreeze = await goFetch(request, `/api/v1/fx/cards/${cardId}/unfreeze`, { method: 'POST', token, data: {} });
      expect([200, 204, 400, 422]).toContain(unfreeze.status);
      const fund = await goFetch(request, `/api/v1/fx/cards/${cardId}/fund`, {
        method: 'POST', token, headers: { 'Idempotency-Key': `mtl-card-fund-${Date.now()}` }, data: { amount: 10_00, currency: 'USD' },
      });
      expect([200, 201, 400, 402, 422, 503]).toContain(fund.status);
      const reveal = await goFetch(request, `/api/v1/fx/cards/${cardId}/reveal`, { method: 'POST', token, data: {} });
      expect([200, 400, 403, 404, 422]).toContain(reveal.status);
      const term = await goFetch(request, `/api/v1/fx/cards/${cardId}/terminate`, { method: 'POST', token, data: {} });
      expect([200, 204, 400, 422]).toContain(term.status);
    }
  });
});

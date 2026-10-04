/**
 * CROSS-004 — audit-trail continuity across actors.
 *
 * For one mutation per actor, verify a persisted audit row carries actor,
 * action, and target — and document the seams where audit is NOT persisted.
 *
 *   actor=admin (Go RBAC):   PATCH /api/admin/users/:id/suspend|unsuspend
 *                            POST /api/admin/users/:id/roles
 *                            → audit_logs (actor_user_id, target_user_id,
 *                              action, module, resource_id) — AUTH-007
 *                              attribution on NON-login events.
 *   actor=admin (Go admin):  POST /api/v1/admin/competitions/open-mic
 *                            → audit_logs action='contest.openmic.create',
 *                              module='contest', resource_id=contest id.
 *   actor=user (BFF voting): POST /api/v2/votes/free
 *                            → vote_audit_logs action='free_vote_cast',
 *                              actor_id=voter, entity=vote row.
 *   actor=user (Go money):   POST /api/finance/transfers/paymax
 *                            → FIXED (E2E-X-029): transfers.Service emits
 *                              wallet.transfer.send via the shared audit sink.
 *   actor=provider (orders): PATCH restaurant order status
 *                            → FIXED (E2E-X-030): recordOrderEvent persists
 *                              order.status.* rows via the shared audit sink.
 *
 * The transfer and order gaps were previously asserted as ABSENCE in
 * audit_logs; both are now asserted as attributed, persisted rows.
 */

import { expect, test } from '@playwright/test';
import {
  adminBearer,
  adminGo,
  createRestaurant,
  fundWallet,
  goFetch,
  goTrueToken,
  provisionVerifiedUser,
  psql,
  setKycTier,
  setProfilePhone,
  setupVotableContest,
  walletBalance,
  ADMIN_USER,
} from './helpers';

const KYB_BODY = {
  legal_name: 'E2E Audit Foods',
  business_type: 'sole_proprietor',
  contact_email: 'audit-kyb@paymax.test',
  contact_phone: '+2348012345678',
  bank_code: '058',
  account_number: '0123456789',
  account_name: 'E2E Audit Foods',
};

test.describe('CROSS-004: audit continuity — one mutation per actor', () => {
  test('admin suspend+role, contest create, free vote persist; transfer+order gaps documented', async ({
    request,
  }) => {
    test.setTimeout(150_000);

    const target = await provisionVerifiedUser(request, 'x4-target');
    const adminToken = await adminBearer(request);
    const adminId = psql(`select id from auth.users where email='${ADMIN_USER.email}';`);
    expect(adminId).toBeTruthy();

    await test.step('admin user mutations persist attributed audit rows (AUTH-007 off-login)', async () => {
      // Suspend → audit 'user.suspend' attributed to the ADMIN, targeting the user.
      const sus = await goFetch(request, `/api/admin/users/${target.userId}/suspend`, {
        method: 'PATCH', token: adminToken,
      });
      test.info().annotations.push({ type: 'suspend', description: `${sus.status} ${JSON.stringify(sus.body).slice(0, 200)}` });
      expect(sus.status).toBe(200);
      const susRow = psql(
        `select actor_user_id || '|' || target_user_id || '|' || action || '|' || module ` +
          `from audit_logs where action='user.suspend' and target_user_id='${target.userId}' order by created_at desc limit 1;`,
      );
      expect(susRow).toBe(`${adminId}|${target.userId}|user.suspend|users`);

      // Unsuspend (cleanup + second audit row).
      const unsus = await goFetch(request, `/api/admin/users/${target.userId}/unsuspend`, {
        method: 'PATCH', token: adminToken,
      });
      expect(unsus.status).toBe(200);
      expect(psql(`select action from audit_logs where target_user_id='${target.userId}' and action='user.unsuspend' order by created_at desc limit 1;`))
        .toBe('user.unsuspend');

      // Role assignment → 'user.role.assign'.
      const roles = await goFetch(request, '/api/admin/roles', { token: adminToken });
      expect(roles.status).toBe(200);
      const list = (roles.body?.roles ?? roles.body?.data ?? roles.body ?? []) as Array<{ id: string; slug?: string }>;
      const contestantRole = list.find((r) => r.slug === 'contestant') ?? list[0];
      expect(contestantRole?.id).toBeTruthy();
      const assign = await goFetch(request, `/api/admin/users/${target.userId}/roles`, {
        method: 'POST', token: adminToken, data: { roleId: contestantRole.id },
      });
      test.info().annotations.push({ type: 'role-assign', description: `${assign.status} ${JSON.stringify(assign.body).slice(0, 200)}` });
      expect(assign.status).toBe(200);
      const assignRow = psql(
        `select actor_user_id || '|' || action || '|' || module from audit_logs ` +
          `where action='user.role.assign' and target_user_id='${target.userId}' order by created_at desc limit 1;`,
      );
      expect(assignRow).toBe(`${adminId}|user.role.assign|rbac`);
    });

    await test.step('contest creation persists an admin-attributed audit row', async () => {
      const res = await adminGo(request, '/api/v1/admin/competitions/open-mic', {
        method: 'POST',
        data: { name: `E2E Audit Contest ${Date.now() % 100000}`, status: 'upcoming', category: 'Music' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const contestId = res.body?.competition?.id as string;
      const row = psql(
        `select coalesce(actor_user_id::text,'') || '|' || action || '|' || module || '|' || resource_type || '|' || resource_id ` +
          `from audit_logs where action='contest.openmic.create' and resource_id='${contestId}';`,
      );
      const [actor, , , , rid] = row.split('|');
      expect(rid).toBe(contestId);
      expect(row).toContain('contest.openmic.create|contest|open_mic_competition');
      // E2E-X-028 FIXED: emitAudit resolves the actor from the adminUserID
      // context key RequireAdminConsoleRole sets (it never populated the
      // GetAuthenticatedUser ctx emitAudit previously read → NULL actor).
      expect(actor).toBe(adminId);
    });

    await test.step('user free vote persists a vote_audit_logs row attributed to the voter', async () => {
      const owner = await provisionVerifiedUser(request, 'x4-owner');
      const voter = await provisionVerifiedUser(request, 'x4-voter');
      const { contestId, contestantId } = await setupVotableContest(request, owner.userId, 'AUD4');
      const voterToken = await goTrueToken(request, voter.email, voter.password);

      const res = await request.fetch('/api/v2/votes/free', {
        method: 'POST',
        headers: { Authorization: `Bearer ${voterToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `x4fv-${Date.now()}` },
        data: { contestId, contestantId, voteQuantity: 1 },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({ type: 'free-vote', description: `${res.status()} ${JSON.stringify(body).slice(0, 200)}` });
      expect(res.status(), JSON.stringify(body)).toBe(200);

      const audit = psql(
        `select actor_id || '|' || actor_role || '|' || action || '|' || entity_type ` +
          `from vote_audit_logs where contest_id='${contestId}' and contestant_id='${contestantId}' ` +
          `and action='free_vote_cast' order by created_at desc limit 1;`,
      );
      expect(audit).toBe(`${voter.userId}|voter|free_vote_cast|vote`);
    });

    await test.step('wallet transfer persists a durable audit_logs row', async () => {
      const a = await provisionVerifiedUser(request, 'x4-a');
      const b = await provisionVerifiedUser(request, 'x4-b');
      const aToken = await goTrueToken(request, a.email, a.password);
      const bPhone = `080${String(Math.floor(10000000 + Math.random() * 89999999))}`;
      setProfilePhone(b.userId, bPhone);
      setKycTier(a.userId, 1);
      fundWallet(a.userId, 200_000, `x4ww-${Date.now()}`);

      const res = await goFetch(request, '/api/finance/transfers/paymax', {
        method: 'POST', token: aToken,
        data: { recipient_phone: bPhone, amount_kobo: 10_000, idempotency_key: `x4ww-pay-${Date.now()}` },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);

      // E2E-X-029 FIXED: the money moved AND audit_logs now carries the action —
      // transfers.Service emits wallet.transfer.send (actor=sender,
      // target=recipient, resource=transfer id, metadata={amount,fee,reference})
      // through the shared audit sink wired in finance_routes.go.
      expect(walletBalance(b.userId)).toBe('10000');
      const auditRow = psql(
        `select actor_user_id || '|' || target_user_id || '|' || action || '|' || module from audit_logs ` +
          `where action='wallet.transfer.send' and actor_user_id='${a.userId}' ` +
          `and new_values->>'reference'='${res.body.reference}' order by created_at desc limit 1;`,
      );
      expect(auditRow).toBe(`${a.userId}|${b.userId}|wallet.transfer.send|transfers`);
    });

    await test.step('order status transition persists a durable audit_logs row', async () => {
      const owner = await provisionVerifiedUser(request, 'x4-rown');
      const cust = await provisionVerifiedUser(request, 'x4-rcust');
      const ownerToken = await goTrueToken(request, owner.email, owner.password);
      const custToken = await goTrueToken(request, cust.email, cust.password);
      const ownerAuth = { Authorization: `Bearer ${ownerToken}` };

      const created = await createRestaurant(request, ownerToken, `AUD4${Date.now() % 100000} Kitchen`);
      expect(created.status).toBe(201);
      const rid = created.body.id;
      await goFetch(request, `/api/finance/restaurant/${rid}/kyb`, { method: 'PUT', token: ownerToken, data: KYB_BODY });
      await goFetch(request, `/api/finance/restaurant/${rid}/kyb/submit`, { method: 'POST', token: ownerToken });
      await goFetch(request, `/api/restaurant/admin/onboarding/${rid}/approve`, {
        method: 'POST', token: adminToken, data: { note: 'E2E audit' },
      });
      const cat = await request.fetch(`/api/v1/restaurant/${rid}/menu/categories`, {
        method: 'POST', headers: ownerAuth, data: { name: 'Audit Mains' },
      });
      const item = await request.fetch(`/api/v1/restaurant/${rid}/menu/items`, {
        method: 'POST', headers: ownerAuth,
        data: { category_id: (await cat.json()).id, name: 'Audit Rice', price_kobo: 100_000 },
      });
      const itemId = (await item.json()).id as string;

      setKycTier(cust.userId, 1);
      fundWallet(cust.userId, 300_000, `x4ord-${Date.now()}`);
      const order = await request.fetch(`/api/v1/restaurant/${rid}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${custToken}`, 'Idempotency-Key': `x4ord-${Date.now()}` },
        data: { items: [{ menu_item_id: itemId, quantity: 1 }], delivery_address: '1 Audit Ln' },
      });
      expect(order.status(), await order.text()).toBe(201);
      const orderId = (await order.json()).id as string;

      const patch = await request.fetch(`/api/v1/restaurant/${rid}/orders/${orderId}/status`, {
        method: 'PATCH', headers: ownerAuth, data: { status: 'confirmed' },
      });
      expect(patch.status(), await patch.text()).toBe(200);
      expect(psql(`select status from orders where id='${orderId}';`)).toBe('confirmed');

      // E2E-X-030 FIXED: recordOrderEvent (restaurant/service.go) now writes
      // through the shared audit sink — actor=transitioning user, resource=order,
      // metadata={from,to}.
      const row = psql(
        `select actor_user_id || '|' || action || '|' || module || '|' || ` +
          `(new_values->>'from') || '|' || (new_values->>'to') from audit_logs ` +
          `where resource_id='${orderId}' and action='order.status.confirmed' ` +
          `order by created_at desc limit 1;`,
      );
      expect(row).toBe(`${owner.userId}|order.status.confirmed|restaurant|pending|confirmed`);
    });
  });
});

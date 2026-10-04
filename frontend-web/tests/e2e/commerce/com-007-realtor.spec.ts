/**
 * CMS-007 — realtor admin control plane (moderation + escrow money path).
 *
 * The realtor write plane lives in Supabase RPCs (member listing creation is
 * not a Go surface), so the uncovered Go paths are the RBAC-gated admin
 * endpoints under /api/realtor/admin plus the stays→estate gate-pass bridge.
 * Seeds the object chain via fixture SQL and exercises:
 *   overview → pending listings → decide listing → pending verifications →
 *   decide verification → payments → escrow → escrow resolve (inspection-
 *   gated ledger reversal, idempotent + terminal-state guarded).
 * Every mutation must also write realtor_admin_audit_log rows.
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  goFetch,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  seedRealtorEscrow,
  seedRealtorListing,
  walletBalance,
} from './helpers';

test.describe('CMS-007 realtor admin: moderation + escrow resolution', () => {
  test('listing moderation queue + verification decision + audit rows', async ({ request }) => {
    const tag = `${Date.now() % 100000}`;
    const owner = await provisionVerifiedUser(request, 'cms-own');
    const chain = seedRealtorListing(owner.userId, tag);

    const overview = await adminFetch(request, '/api/realtor/admin/overview');
    expect(overview.status).toBe(200);

    const pending = await adminFetch(request, '/api/realtor/admin/listings/pending');
    expect(pending.status).toBe(200);
    const rows = pending.body?.data ?? [];
    expect(rows.some((r: any) => r.id === chain.listingId)).toBe(true);

    // Invalid decision → 400 before any write.
    const bad = await adminFetch(request, `/api/realtor/admin/listings/${chain.listingId}/decision`, {
      method: 'POST',
      data: { decision: 'bogus', reason: 'x' },
    });
    expect(bad.status).toBe(400);

    const decide = await adminFetch(request, `/api/realtor/admin/listings/${chain.listingId}/decision`, {
      method: 'POST',
      data: { decision: 'approved', reason: 'e2e clean' },
    });
    expect(decide.status).toBe(200);
    expect(decide.body.status).toBe('published');

    const verifs = await adminFetch(request, '/api/realtor/admin/verifications');
    expect(verifs.status).toBe(200);
    const vDecide = await adminFetch(request, `/api/realtor/admin/verifications/${chain.listingId}/decision`, {
      method: 'POST',
      data: { status: 'approved', reason: 'e2e docs ok' },
    });
    expect(vDecide.status).toBe(200);
    const verification = psql(`select verification from realtor_listings where id='${chain.listingId}';`);
    expect(verification).toBe('verified');

    // Audit rows for both decisions.
    const audits = psql(
      `select count(*) from realtor_admin_audit_log where entity_id='${chain.listingId}';`,
    );
    expect(Number(audits)).toBeGreaterThanOrEqual(2);

    const payments = await adminFetch(request, '/api/realtor/admin/payments');
    expect(payments.status).toBe(200);
  });

  test('escrow resolve is inspection-gated, idempotent, terminal-state guarded', async ({ request }) => {
    const tag = `${Date.now() % 100000}`;
    const owner = await provisionVerifiedUser(request, 'cms-ll');
    const tenant = await provisionVerifiedUser(request, 'cms-ten');
    const chain = seedRealtorListing(owner.userId, tag);

    // Deposit WITHOUT a submitted move-out → release must fail closed (422).
    const blocked = seedRealtorEscrow(chain, tenant.userId, 2_000_000, { withMoveOut: false });
    const noMoveOut = await adminFetch(request, `/api/realtor/admin/escrow/${blocked.escrowId}/resolve`, {
      method: 'POST',
      data: { decision: 'released_to_tenant', note: 'should fail' },
    });
    expect(noMoveOut.status).toBe(422);

    // Deposit WITH move-out → release posts the reversal to the tenant wallet.
    const ok = seedRealtorEscrow(chain, tenant.userId, 3_000_000, { withMoveOut: true });
    const list = await adminFetch(request, '/api/realtor/admin/escrow');
    expect(list.status).toBe(200);

    const before = Number(walletBalance(tenant.userId));
    const resolve = await adminFetch(request, `/api/realtor/admin/escrow/${ok.escrowId}/resolve`, {
      method: 'POST',
      data: { decision: 'released_to_tenant', note: 'e2e inspection passed' },
    });
    expect(resolve.status).toBe(200);
    expect(resolve.body.status).toBe('released');
    expect(resolve.body.resolvedTo).toBe('tenant');

    // Balanced reversal legs under the deterministic reference. Release posts
    // REVERSAL_DEBIT (tenant wallet +balance) / REVERSAL_CREDIT (settlement -).
    const legs = ledgerSums(`realtor:escrow:release:${ok.escrowId}%`);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    const tenantCredit = legs.find((l) => l.accountUserId === tenant.userId);
    expect(tenantCredit?.side).toBe('REVERSAL_DEBIT');
    expect(tenantCredit?.total).toBe(3_000_000);
    expect(Number(walletBalance(tenant.userId))).toBe(before + 3_000_000);

    // Terminal: a second resolve is rejected 409 — no double payout.
    const again = await adminFetch(request, `/api/realtor/admin/escrow/${ok.escrowId}/resolve`, {
      method: 'POST',
      data: { decision: 'forfeited_to_landlord', note: 'retry' },
    });
    expect(again.status).toBe(409);
    const legs2 = ledgerSums(`realtor:escrow:release:${ok.escrowId}%`);
    expect(legs2.filter((l) => l.accountUserId === tenant.userId)[0].total).toBe(3_000_000);

    // Disputed is non-terminal: flag then release.
    const third = seedRealtorEscrow(chain, tenant.userId, 1_000_000, { withMoveOut: true });
    const dispute = await adminFetch(request, `/api/realtor/admin/escrow/${third.escrowId}/resolve`, {
      method: 'POST',
      data: { decision: 'disputed', note: 'e2e flag' },
    });
    expect(dispute.status).toBe(200);
    const release = await adminFetch(request, `/api/realtor/admin/escrow/${third.escrowId}/resolve`, {
      method: 'POST',
      data: { decision: 'forfeited_to_landlord', note: 'e2e damage' },
    });
    expect(release.status).toBe(200);
    expect(release.body.resolvedTo).toBe('landlord');
    const forfeitLegs = ledgerSums(`realtor:escrow:forfeit:${third.escrowId}%`);
    expect(forfeitLegs.length).toBeGreaterThanOrEqual(2);
    const landlordCredit = forfeitLegs.find((l) => l.accountUserId === owner.userId && l.side === 'CREDIT');
    expect(landlordCredit?.total).toBe(1_000_000);
  });

  test('stays→estate gate-pass bridge is fail-closed for unknown bookings', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-gp');
    const token = await goTrueToken(request, user.email, user.password);
    // Unknown booking → 404 (not "any pass"); another user's booking → 403/404.
    const res = await goFetch(request, '/api/finance/realtor/stays/00000000-0000-0000-0000-000000000000/gate-pass', { token });
    expect([403, 404]).toContain(res.status);
    // Unauthenticated → 401.
    const noAuth = await goFetch(request, '/api/finance/realtor/stays/00000000-0000-0000-0000-000000000000/gate-pass');
    expect(noAuth.status).toBe(401);
  });
});

/**
 * ASSOCIATION (community dues) — money journey + application workflow.
 * Mount: :8080/api/finance/associations/* (FEATURE_ASSOCIATION_ENABLED).
 *
 * Proves the full chain the requested journey needs:
 *   publish organisation → founder membership → member application → admin
 *   approval → dues run / ad-hoc invoice → wallet pay → receipt → ledger legs.
 * Tier-gate fail-closed: a tier-0 member's pay attempt posts ZERO ledger legs;
 * a retry after promotion succeeds (refusals leave no idempotency residue).
 */

import { test, expect } from '@playwright/test';
import {
  goFetch,
  provisionVerifiedUser,
  goTrueToken,
  fundWallet,
  setKycVerified,
  assertKoboIntegers,
  walletBalanceSql,
  countLegsByRef,
  ledgerTotalsByRef,
  idemKey,
  psql,
} from './helpers';

const BASE = '/api/finance/associations';
const DUES_KOBO = 150_000; // ₦1,500 dues tier
const FUND_KOBO = 2_000_000;

const IDEM = (k: string) => ({ 'Idempotency-Key': k });

interface PublishResponse {
  organisationId: string;
  name: string;
}

async function publishOrg(
  request: Parameters<typeof goFetch>[0],
  token: string,
  name: string,
  opts: { groupType?: string; duesKobo?: number; idem?: string } = {},
): Promise<PublishResponse> {
  const res = await goFetch(request, BASE, {
    method: 'POST',
    token,
    headers: opts.idem ? IDEM(opts.idem) : undefined,
    data: {
      name,
      acronym: name.slice(0, 4).toUpperCase(),
      category: 'TRADE',
      description: 'e2e community-finance association',
      logoUri: 'https://cdn.example.com/e2e/logo.png',
      foundedYear: 2015,
      groupType: opts.groupType ?? 'OPEN',
      categories: [{ label: 'Standard', duesKobo: opts.duesKobo ?? DUES_KOBO, cadence: 'ANNUAL' }],
      acceptedTerms: true,
    },
  });
  expect(res.status).toBe(201);
  return res.body;
}

test.describe('association community dues', () => {
  test('org → dues run → wallet pay → receipt → balanced legs; tier-0 refusal posts none', async ({
    request,
  }) => {
    const founder = await provisionVerifiedUser(request, 'assoc-founder');
    const founderToken = await goTrueToken(request, founder.email, founder.password);
    setKycVerified(founder.userId, 3);
    fundWallet(founder.userId, FUND_KOBO, `assoc-f-${Date.now()}`);

    // ── Publish (idempotent replay returns the same org) ────────────────────
    const pubIdem = idemKey('assoc-pub');
    const pub = await publishOrg(request, founderToken, `E2E Assoc ${Date.now()}`, { idem: pubIdem });
    // Replay with the same key AND a valid draft — validation precedes the
    // replay lookup, so the same request body must be resent.
    const replay = await goFetch(request, BASE, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(pubIdem),
      data: {
        name: `E2E Assoc ${Date.now()}`,
        acronym: 'E2EA',
        category: 'TRADE',
        logoUri: 'https://cdn.example.com/e2e/logo.png',
        foundedYear: 2015,
        groupType: 'OPEN',
        acceptedTerms: true,
      },
    });
    expect(replay.status).toBe(201);
    expect(replay.body?.organisationId).toBe(pub.organisationId);
    const orgId = pub.organisationId;

    // Founder can see the org and their own dashboard.
    const detail = await goFetch(request, `${BASE}/orgs/${orgId}`, { token: founderToken });
    expect(detail.status).toBe(200);
    expect(assertKoboIntegers(detail.body)).toEqual([]);
    const dash = await goFetch(request, `${BASE}/me/dashboard`, { token: founderToken });
    expect(dash.status).toBe(200);

    // ── Dues run (idempotent) → invoice on the founder's membership ─────────
    const runIdem = idemKey('assoc-run');
    const run = await goFetch(request, `${BASE}/admin/organisations/${orgId}/dues/run`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(runIdem),
      data: { title: 'E2E annual dues' },
    });
    expect(run.status).toBe(200);
    expect(run.body.invoiced).toBe(1);
    expect(run.body.totalKobo).toBe(DUES_KOBO);
    const runReplay = await goFetch(request, `${BASE}/admin/organisations/${orgId}/dues/run`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(runIdem),
      data: { title: 'E2E annual dues' },
    });
    expect(runReplay.status).toBe(200);
    expect(runReplay.body.alreadyRaised).toBe(true);

    const dues = await goFetch(request, `${BASE}/me/dues`, { token: founderToken });
    expect(dues.status).toBe(200);
    expect(dues.body.outstandingKobo).toBe(DUES_KOBO);
    const invoice = dues.body.invoices.find((i: any) => i.status === 'DUE');
    expect(invoice).toBeTruthy();
    expect(assertKoboIntegers(dues.body)).toEqual([]);

    // Missing Idempotency-Key on a money mutation must fail, not silently pay.
    const noIdem = await goFetch(request, `${BASE}/dues/${invoice.id}/pay`, {
      method: 'POST',
      token: founderToken,
      data: { method: 'WALLET' },
    });
    expect(noIdem.status).toBeGreaterThanOrEqual(400);
    expect(noIdem.status).toBeLessThan(500);

    // ── Wallet pay → receipt → balanced ledger legs ─────────────────────────
    const before = walletBalanceSql(founder.userId);
    const payIdem = idemKey('assoc-pay');
    const pay = await goFetch(request, `${BASE}/dues/${invoice.id}/pay`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(payIdem),
      data: { method: 'WALLET' },
    });
    expect(pay.status).toBe(200);
    expect(pay.body.status).toBe('SUCCESS');
    expect(pay.body.receiptId).toBe(`rcpt_${invoice.id}`);

    const totals = ledgerTotalsByRef(`assoc_dues:${invoice.id}`);
    expect(totals.debits).toBe(DUES_KOBO);
    expect(totals.credits).toBe(DUES_KOBO); // balanced double-entry
    expect(walletBalanceSql(founder.userId)).toBe(before - DUES_KOBO);

    // Replay with the same key → same receipt, zero additional legs.
    const payReplay = await goFetch(request, `${BASE}/dues/${invoice.id}/pay`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(payIdem),
      data: { method: 'WALLET' },
    });
    expect(payReplay.status).toBe(200);
    expect(payReplay.body.status).toBe('SUCCESS');
    expect(ledgerTotalsByRef(`assoc_dues:${invoice.id}`).debits).toBe(DUES_KOBO);

    const receipt = await goFetch(request, `${BASE}/receipts/${pay.body.receiptId}`, {
      token: founderToken,
    });
    expect(receipt.status).toBe(200);
    expect(receipt.body.amountKobo).toBe(DUES_KOBO);
    expect(receipt.body.method).toBe('WALLET');
    expect(assertKoboIntegers(receipt.body)).toEqual([]);

    const duesAfter = await goFetch(request, `${BASE}/me/dues`, { token: founderToken });
    expect(duesAfter.body.invoices.find((i: any) => i.id === invoice.id).status).toBe('PAID');

    // ── Tier-0 member: refused pay posts ZERO legs; promoted retry succeeds ─
    const member = await provisionVerifiedUser(request, 'assoc-member');
    const memberToken = await goTrueToken(request, member.email, member.password); // stays kyc_tier=0

    const app = await goFetch(request, `${BASE}/apply`, {
      method: 'POST',
      token: memberToken,
      data: { organisationId: orgId, acceptedRules: true },
    });
    expect([200, 201]).toContain(app.status);
    // OPEN orgs auto-approve; the member is ACTIVE immediately.

    const memberMembershipId = psql(
      `select id from assoc_memberships where organisation_id='${orgId}' and user_id='${member.userId}';`,
    );
    expect(memberMembershipId).toBeTruthy();

    const inv = await goFetch(request, `${BASE}/admin/invoices`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(idemKey('assoc-inv')),
      data: { membershipId: memberMembershipId, title: 'E2E member dues', amountKobo: DUES_KOBO },
    });
    expect(inv.status).toBe(201);
    const memberInvoiceId = inv.body.id;

    const refuse = await goFetch(request, `${BASE}/dues/${memberInvoiceId}/pay`, {
      method: 'POST',
      token: memberToken,
      headers: IDEM(idemKey('assoc-pay0')),
      data: { method: 'WALLET' },
    });
    expect(refuse.status).toBe(403); // EnforceWalletDebitLimit fails closed
    expect(countLegsByRef(`assoc_dues:${memberInvoiceId}`)).toBe(0); // ZERO legs

    // Promote + fund, retry — succeeds and settles balanced.
    setKycVerified(member.userId, 3);
    fundWallet(member.userId, FUND_KOBO, `assoc-m-${Date.now()}`);
    const retry = await goFetch(request, `${BASE}/dues/${memberInvoiceId}/pay`, {
      method: 'POST',
      token: memberToken,
      headers: IDEM(idemKey('assoc-pay1')),
      data: { method: 'WALLET' },
    });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('SUCCESS');
    const memberTotals = ledgerTotalsByRef(`assoc_dues:${memberInvoiceId}`);
    expect(memberTotals.debits).toBe(DUES_KOBO);
    expect(memberTotals.credits).toBe(DUES_KOBO);
    expect(walletBalanceSql(member.userId)).toBe(FUND_KOBO - DUES_KOBO);
  });

  test('CLOSED org application → founder approves → member sees org; non-admin decision refused', async ({
    request,
  }) => {
    const founder = await provisionVerifiedUser(request, 'assoc-owner');
    const founderToken = await goTrueToken(request, founder.email, founder.password);
    const applicant = await provisionVerifiedUser(request, 'assoc-app');
    const applicantToken = await goTrueToken(request, applicant.email, applicant.password);

    const pub = await publishOrg(request, founderToken, `E2E Closed ${Date.now()}`, {
      groupType: 'CLOSED',
      duesKobo: 0,
    });

    const app = await goFetch(request, `${BASE}/apply`, {
      method: 'POST',
      token: applicantToken,
      data: { organisationId: pub.organisationId, acceptedRules: true },
    });
    expect([200, 201]).toContain(app.status);
    expect(app.body.applicationId).toBeTruthy();
    const appId = app.body.applicationId;

    // Applicant cannot decide their own application (org-admin cap check).
    const selfDecide = await goFetch(request, `${BASE}/admin/approvals/${appId}/decision`, {
      method: 'POST',
      token: applicantToken,
      headers: IDEM(idemKey('assoc-dec0')),
      data: { decision: 'APPROVE' },
    });
    expect(selfDecide.status).toBe(403);

    // Founder sees the pending application and approves it.
    const approvals = await goFetch(request, `${BASE}/admin/approvals`, { token: founderToken });
    expect(approvals.status).toBe(200);
    const decide = await goFetch(request, `${BASE}/admin/approvals/${appId}/decision`, {
      method: 'POST',
      token: founderToken,
      headers: IDEM(idemKey('assoc-dec1')),
      data: { decision: 'APPROVE' },
    });
    expect(decide.status).toBe(200);

    // Applicant is now an active member — card + dashboard resolve.
    const card = await goFetch(request, `${BASE}/me/card`, { token: applicantToken });
    expect(card.status).toBe(200);
    const memberDash = await goFetch(request, `${BASE}/me/dashboard`, { token: applicantToken });
    expect(memberDash.status).toBe(200);
  });
});

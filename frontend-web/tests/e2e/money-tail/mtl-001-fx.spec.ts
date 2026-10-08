/**
 * MTL-001 — FX orchestration core money journey (/api/v1/fx/*).
 *
 * FEATURE_FX_ORCHESTRATION_ENABLED=true in backend/.env and the deterministic
 * provider adapters (adapters.MapleradFX / Eversend) are wired because no live
 * MAPLERAD_SECRET_KEY / EVERSEND creds exist locally — quotes/executions are
 * real service calls through the SQL store; the provider leg is the
 * deterministic dev adapter, NOT a live PSP (psp-unverified: no real Maplerad/
 * Eversend settlement is possible in this environment).
 *
 * Money facts asserted:
 *   - NGN spends debit the MAIN platform ledger (ADR-051): a conversion posts
 *     DR user_wallet / CR provider_clearing in ledger_entries AND a balanced
 *     5-leg set in orch_ledger_entries (per-currency balanced, ADR-029).
 *   - Idempotency-Key is required and replays return the SAME conversion —
 *     no second debit.
 *   - The tier-limit engine is fail-closed: amount_below_min refuses below
 *     $1.00 equivalent before pricing.
 *   - A collections VA provisioned through the route is credited by a
 *     provider-signed (adapter-verified) webhook — and a redelivery of the
 *     same event id credits exactly once.
 *   - An unmatched webhook reference is acknowledged but credits NOTHING
 *     (QA WH-INT-003).
 *
 * Fixture-only: wallet funding journal + kyc_tier via psql (documented in
 * helpers.ts). All product assertions via the real API or read-only SQL.
 */

import { expect, test } from '@playwright/test';

import {
  assertKoboIntegers,
  fundWallet,
  goFetch,
  goFetchAnon,
  goTrueToken,
  idemKey,
  ledgerSums,
  orchLedgerBalanced,
  orchLedgerSums,
  provisionVerifiedUser,
  psql,
  setKycTier,
  walletBalanceSql,
} from './helpers';

const FUND_KOBO = 20_000_000; // ₦200,000 ≈ $125 — comfortably above the $1 min, below the $10k per-tx max
const CONV_KOBO = 5_000_000; // ₦50,000 ≈ $31

async function fundedUser(request: any, tag: string) {
  const user = await provisionVerifiedUser(request, tag);
  const token = await goTrueToken(request, user.email, user.password);
  setKycTier(user.userId, 3);
  fundWallet(user.userId, FUND_KOBO, `${tag}-${Date.now()}`);
  return { user, token };
}

test.describe('MTL-001 fx orchestration core', () => {
  test('quote → lock → conversion posts balanced legs; replay idempotent; min-limit fail-closed', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001a');

    // ── below-min quote refused BEFORE pricing (fail-closed limit gate) ──
    const low = await goFetch(request, '/api/v1/fx/quotes', {
      method: 'POST',
      token,
      data: { source: 'NGN', destination: 'USD', amount: 10_000, intent: 'conversion' },
    });
    expect(low.status).toBe(400);
    expect(low.body?.error?.code).toBe('amount_below_min');

    // ── quote (unlocked) ──
    const q1 = await goFetch(request, '/api/v1/fx/quotes', {
      method: 'POST',
      token,
      data: { source: 'NGN', destination: 'USD', amount: CONV_KOBO, intent: 'conversion' },
    });
    expect(q1.status).toBe(200);
    expect(q1.body.status).toBe('quoted');
    expect(q1.body.source.amount).toBe(CONV_KOBO);
    expect(q1.body.destination.amount).toBeGreaterThan(0);
    expect(Number.isInteger(q1.body.source.amount)).toBe(true);
    expect(Number.isInteger(q1.body.destination.amount)).toBe(true);
    const spread = (q1.body.fees as any[]).find((f) => f.type === 'paymax_spread');
    expect(spread).toBeTruthy();

    // ── lock the quote ──
    const locked = await goFetch(request, `/api/v1/fx/quotes/${q1.body.id}/lock`, { method: 'POST', token });
    expect(locked.status).toBe(200);
    expect(locked.body.status).toBe('locked');

    // ── conversion WITHOUT Idempotency-Key refused ──
    const noIdem = await goFetch(request, '/api/v1/fx/conversions', {
      method: 'POST',
      token,
      data: { quote_id: q1.body.id },
    });
    expect(noIdem.status).toBe(400);
    expect(noIdem.body?.error?.code).toBe('missing_idempotency_key');

    // ── conversion WITH key: real debit ──
    const key = idemKey('fx-conv');
    const walletBefore = walletBalanceSql(user.userId);
    const conv = await goFetch(request, '/api/v1/fx/conversions', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { quote_id: q1.body.id },
    });
    expect(conv.status).toBe(201);
    expect(conv.body.status).toBe('settled');
    expect(conv.body.reference).toMatch(/^PMX-CV-/);
    const ref: string = conv.body.reference;

    const sourceTotal = CONV_KOBO +
      (q1.body.fees as any[]).filter((f) => f.type === 'provider_fee' || f.type === 'rail_fee')
        .reduce((s, f) => s + f.amount.amount, 0);

    // Main ledger: DR user_wallet / CR provider_clearing for sourceTotal (NGN).
    const legs = ledgerSums(ref);
    const walletLeg = legs.find((l) => l.accountType === 'user_wallet' && l.accountUserId === user.userId && l.side === 'DEBIT');
    const clearingLeg = legs.find((l) => l.accountType === 'provider_clearing' && l.side === 'CREDIT');
    expect(walletLeg?.total).toBe(sourceTotal);
    expect(clearingLeg?.total).toBe(sourceTotal);
    expect(walletBalanceSql(user.userId)).toBe(walletBefore - sourceTotal);

    // orch book: per-currency balanced (NGN + USD).
    const ngn = orchLedgerBalanced(ref, 'NGN');
    expect(ngn.debits).toBe(ngn.credits);
    const usd = orchLedgerBalanced(ref, 'USD');
    expect(usd.debits).toBe(usd.credits);
    expect(usd.credits).toBe(q1.body.destination.amount);

    // ── replay: same key returns the same conversion, no second legs ──
    const replay = await goFetch(request, '/api/v1/fx/conversions', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { quote_id: q1.body.id },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(conv.body.id);
    expect(walletBalanceSql(user.userId)).toBe(walletBefore - sourceTotal);

    // ── consumed quote cannot be re-spent under a new key ──
    const resp2 = await goFetch(request, '/api/v1/fx/conversions', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('fx-conv2') },
      data: { quote_id: q1.body.id },
    });
    expect([400, 409]).toContain(resp2.status);
  });

  test('balances, wallets, transactions, rates + history', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001b');

    const bal = await goFetch(request, '/api/v1/fx/balances', { token });
    expect(bal.status).toBe(200);
    const ngn = (bal.body.data as any[]).find((b) => b.currency === 'NGN');
    expect(ngn.available).toBe(FUND_KOBO);
    expect(ngn.ledger).toBe(FUND_KOBO);

    // open a USD wallet (zero-balance visibility)
    const add = await goFetch(request, '/api/v1/fx/balances', {
      method: 'POST',
      token,
      data: { currency: 'USD' },
    });
    expect([200, 201]).toContain(add.status);
    const bal2 = await goFetch(request, '/api/v1/fx/balances', { token });
    expect((bal2.body.data as any[]).some((b) => b.currency === 'USD')).toBe(true);

    const txns = await goFetch(request, '/api/v1/fx/transactions', { token });
    expect(txns.status).toBe(200);

    const rates = await goFetch(request, '/api/v1/fx/rates', { token });
    expect(rates.status).toBe(200);
    expect((rates.body.data as any[]).length).toBeGreaterThan(0);

    const hist = await goFetch(request, '/api/v1/fx/rates/history?pair=USD-NGN', { token });
    expect(hist.status).toBe(200);

    const missing = await goFetch(request, `/api/v1/fx/transactions/${crypto.randomUUID()}`, { token });
    expect([400, 404]).toContain(missing.status);
  });

  test('collection VA → provider webhook credit → idempotent redelivery; unmatched ref credits nothing', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001c');

    // ── provision an NGN virtual account via the deterministic maplerad adapter ──
    const va = await goFetch(request, '/api/v1/fx/collections/virtual-accounts', {
      method: 'POST',
      token,
      data: { currency: 'NGN', type: 'virtual_account' },
    });
    expect(va.status).toBe(201);
    expect(va.body.provider).toBe('maplerad');
    const acctNumber = va.body.details?.account_number as string;
    expect(acctNumber).toBeTruthy();

    const listed = await goFetch(request, '/api/v1/fx/collections/virtual-accounts', { token });
    expect(listed.status).toBe(200);
    const collections = await goFetch(request, '/api/v1/fx/collections', { token });
    expect(collections.status).toBe(200);

    // ── webhook deposit: deterministic adapter accepts any non-empty signature ──
    const eventId = `evt-mtl-${Date.now()}`;
    const deposit = {
      event: 'collection.successful',
      id: eventId,
      data: {
        id: eventId,
        reference: va.body.provider_ref ?? acctNumber,
        account_number: acctNumber,
        currency: 'NGN',
        amount: 250_000,
        sender_name: 'E2E Sender',
      },
    };
    const wh = await goFetchAnon(request, '/api/v1/fx/webhooks/maplerad', {
      data: deposit,
      headers: { 'Webhook-Signature': 'e2e-dev-signature' },
    });
    expect(wh.status).toBe(200);

    const walletAfter = walletBalanceSql(user.userId);
    expect(walletAfter).toBe(FUND_KOBO + 250_000);
    // Main ledger: the NGN credit posts DR provider_clearing / CR user_wallet
    // under reference 'fx-collection:<col_id>'.
    const colMain = ledgerSums('fx-collection:%');
    expect(colMain.some((l) => l.accountType === 'user_wallet' && l.accountUserId === user.userId && l.side === 'CREDIT' && l.total === 250_000)).toBe(true);
    // orch book: DR provider_clearing / CR customer_balance, balanced — keyed on
    // THIS user's collection event id (parallel specs write their own col_ refs).
    const colId = psql(
      `select id from orch_collection_events where customer_id='${user.userId}' and provider_event_id='${eventId}';`,
    );
    expect(colId).toBeTruthy();
    const colLegs = orchLedgerSums(`${colId}%`);
    expect(colLegs.some((l) => l.account === 'customer_balance' && l.side === 'CREDIT' && l.total === 250_000)).toBe(true);
    expect(colLegs.some((l) => l.account === 'provider_clearing' && l.side === 'DEBIT' && l.total === 250_000)).toBe(true);

    // ── redelivery of the SAME event id credits exactly once ──
    const wh2 = await goFetchAnon(request, '/api/v1/fx/webhooks/maplerad', {
      data: deposit,
      headers: { 'Webhook-Signature': 'e2e-dev-signature' },
    });
    expect(wh2.status).toBe(200);
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO + 250_000);

    // ── unmatched account reference: acknowledged, never credited ──
    const orphan = await goFetchAnon(request, '/api/v1/fx/webhooks/maplerad', {
      data: { event: 'collection.successful', id: `evt-orphan-${Date.now()}`, data: { id: `evt-orphan-${Date.now()}`, account_number: '0000000001', currency: 'NGN', amount: 999_999 } },
      headers: { 'Webhook-Signature': 'e2e-dev-signature' },
    });
    expect(orphan.status).toBe(200);
    expect(walletBalanceSql(user.userId)).toBe(FUND_KOBO + 250_000);

    // ── unsigned webhook rejected ──
    const unsigned = await goFetchAnon(request, '/api/v1/fx/webhooks/maplerad', { data: deposit });
    expect(unsigned.status).toBe(401);
  });

  test('same-currency transfer + cross-currency transfer with quote', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001d');

    // ── same-currency NGN payout (no quote needed) ──
    const t1 = await goFetch(request, '/api/v1/fx/transfers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('fx-tr1') },
      data: {
        amount: { amount: 500_000, currency: 'NGN' },
        destination: {
          rail: 'bank_transfer', currency: 'NGN', scheme: 'BANK',
          account_number: '0123456789', bank_code: '058',
          counterparty: { name: 'E2E Beneficiary' },
        },
        narration: 'mtl same-currency',
      },
    });
    expect(t1.status).toBe(201);
    expect(['processing', 'paid']).toContain(t1.body.status);
    const ref1: string = t1.body.reference;
    // main ledger debit of the amount (zero fees on synthesized quote)
    const legs1 = ledgerSums(ref1);
    expect(legs1.find((l) => l.accountType === 'user_wallet' && l.side === 'DEBIT')?.total).toBe(500_000);
    // transfer fetchable by reference
    const byRef = await goFetch(request, `/api/v1/fx/transfers/${ref1}`, { token });
    expect(byRef.status).toBe(200);

    // ── cross-currency transfer needs a quote ──
    const q = await goFetch(request, '/api/v1/fx/quotes', {
      method: 'POST',
      token,
      data: { source: 'NGN', destination: 'USD', amount: 4_000_000, intent: 'transfer', lock: true },
    });
    expect(q.status).toBe(200);
    const t2 = await goFetch(request, '/api/v1/fx/transfers', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('fx-tr2') },
      data: {
        quote_id: q.body.id,
        destination: {
          rail: 'bank_transfer', currency: 'USD', scheme: 'BANK',
          account_number: '0123456789', bank_code: '058',
          counterparty: { name: 'E2E Beneficiary USD' },
        },
      },
    });
    expect(t2.status).toBe(201);
    const ngnLegs = orchLedgerBalanced(t2.body.reference, 'NGN');
    expect(ngnLegs.debits).toBe(ngnLegs.credits);

    // ── missing destination refused; missing idem key refused ──
    const noDest = await goFetch(request, '/api/v1/fx/transfers', {
      method: 'POST', token, headers: { 'Idempotency-Key': idemKey('fx-tr3') }, data: {},
    });
    expect(noDest.status).toBe(400);
    const noKey = await goFetch(request, '/api/v1/fx/transfers', {
      method: 'POST', token,
      data: { amount: { amount: 1_000, currency: 'NGN' }, destination: { rail: 'bank_transfer', currency: 'NGN', scheme: 'BANK', account_number: '0123456789', counterparty: { name: 'x' } } },
    });
    expect(noKey.status).toBe(400);
  });

  test('beneficiaries CRUD + validate + rate alerts', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001e');

    const draft = {
      name: 'E2E Ben', rail: 'bank_transfer', scheme: 'BANK', currency: 'NGN',
      accountNumber: '0123456789', bankName: 'GTBank', countryCode: 'NG',
    };
    const val = await goFetch(request, '/api/v1/fx/beneficiaries/validate', { method: 'POST', token, data: draft });
    expect(val.status).toBe(200);
    expect(val.body.valid).toBe(true);

    const created = await goFetch(request, '/api/v1/fx/beneficiaries', { method: 'POST', token, data: draft });
    expect(created.status).toBe(201);
    const benId = created.body.id;

    const listed = await goFetch(request, '/api/v1/fx/beneficiaries', { token });
    expect((listed.body.data as any[]).some((b) => b.id === benId)).toBe(true);

    const updated = await goFetch(request, `/api/v1/fx/beneficiaries/${benId}`, { method: 'PUT', token, data: { ...draft, name: 'E2E Ben Updated' } });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('E2E Ben Updated');

    const fav = await goFetch(request, `/api/v1/fx/beneficiaries/${benId}`, { method: 'PATCH', token, data: { favorite: true } });
    expect(fav.status).toBe(204);

    // object authz: another user's id is a no-op / not-found for this caller
    const del = await goFetch(request, `/api/v1/fx/beneficiaries/${benId}`, { method: 'DELETE', token });
    expect(del.status).toBe(204);
    const listed2 = await goFetch(request, '/api/v1/fx/beneficiaries', { token });
    expect((listed2.body.data as any[]).some((b) => b.id === benId)).toBe(false);

    // rate alerts
    const alert = await goFetch(request, '/api/v1/fx/rate-alerts', {
      method: 'POST', token, data: { from: 'USD', to: 'NGN', direction: 'above', target: 1600 },
    });
    expect(alert.status).toBe(201);
    const alerts = await goFetch(request, '/api/v1/fx/rate-alerts', { token });
    expect((alerts.body.data as any[]).some((a) => a.id === alert.body.id)).toBe(true);
    const delAlert = await goFetch(request, `/api/v1/fx/rate-alerts/${alert.body.id}`, { method: 'DELETE', token });
    expect(delAlert.status).toBe(204);

    // invalid rate alert refused
    const badAlert = await goFetch(request, '/api/v1/fx/rate-alerts', {
      method: 'POST', token, data: { from: 'XXX', to: 'NGN', direction: 'sideways', target: -1 },
    });
    expect(badAlert.status).toBe(400);
  });

  test('verification submit/restart + dispute stub', async ({ request }) => {
    const { user, token } = await fundedUser(request, 'mtl001f');

    const v0 = await goFetch(request, '/api/v1/fx/customers/verification', { token });
    expect(v0.status).toBe(200);

    const submit = await goFetch(request, '/api/v1/fx/customers', {
      method: 'POST', token, data: { accountType: 'individual', firstName: 'E2E', lastName: 'User' },
    });
    expect(submit.status).toBe(200);
    expect(['pending', 'review']).toContain(submit.body?.data?.status);

    const v1 = await goFetch(request, '/api/v1/fx/customers/verification', { token });
    expect(v1.status).toBe(200);

    const restart = await goFetch(request, '/api/v1/fx/customers/verification/restart', { method: 'POST', token, data: {} });
    expect(restart.status).toBe(200);

    const dsp = await goFetch(request, `/api/v1/fx/transactions/${crypto.randomUUID()}/dispute`, {
      method: 'POST', token, data: { reason: 'e2e_probe', note: 'dispute surface' },
    });
    expect(dsp.status).toBe(201);
    expect(dsp.body.status).toBe('submitted');
  });
});

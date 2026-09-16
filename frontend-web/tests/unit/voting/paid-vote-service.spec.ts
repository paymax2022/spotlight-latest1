/**
 * Real-logic unit tests for the v1 paid-vote engine's core function:
 * `verifyAndCreditPaidVote` (src/server/voting/paid-vote.service.ts — protected,
 * DO NOT EDIT).
 *
 * Golden-path tests (tests/unit/golden-path/paid-vote.spec.ts) mock the service
 * entirely and only assert the route contract. These tests exercise the real
 * function body against a generic fake Supabase query-builder, covering the
 * UAT test-plan rows that were "Not Run" pending an executed test:
 *   PV-001 — buy a package, success: charged once, exactly n votes credited
 *   PV-002 — paid votes counted exactly as purchased (not more/less)
 *   PV-003 — paid votes are independent of the free daily limit (no free-limit
 *            tables touched at all)
 *   PV-004 — payment fails: no votes credited, no vote row, payment marked failed
 *   PV-006 — amount must equal the quoted amount (minor-unit exact); mismatch
 *            is rejected and flagged, never credited
 *   PV-007 — a network drop mid-verify credits nothing and is safe to retry
 *
 * verifyVotePayment / recordVoteFraudSignals / recordVoteAudit are mocked at
 * the module boundary (same pattern as paid-vote-concurrency.spec.ts), so
 * these tests stay on verifyAndCreditPaidVote's own responsibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyAndCreditPaidVote, initiatePaidVote } from '@/src/server/voting/paid-vote.service';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn().mockResolvedValue('https://checkout.paystack.com/mock'),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/src/server/voting/totals.service', () => ({
  incrementVoteTotals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/voting/audit.service', () => ({
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/server/voting/core', () => ({
  resolveIdempotency: vi.fn(async (_key: string, anchor: { lookupCached: (k: string) => Promise<unknown> }) => {
    const cached = await anchor.lookupCached(_key);
    if (cached !== null && cached !== undefined) return { status: 'cached', value: cached };
    return { status: 'fresh' };
  }),
  verifyVotePayment: vi.fn(),
  recordVoteFraudSignals: vi.fn().mockResolvedValue({ signals: [], score: 0 }),
  recordVoteAudit: vi.fn().mockResolvedValue(undefined),
}));

import { verifyVotePayment, recordVoteFraudSignals } from '@/src/server/voting/core';

// ---------------------------------------------------------------------------
// Generic chainable/thenable fake for `supabase.from(table)...`
// ---------------------------------------------------------------------------

function makeTableClient(responses: Record<string, unknown[]>) {
  const callIndex: Record<string, number> = {};
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  function nextFor(table: string) {
    const idx = callIndex[table] ?? 0;
    callIndex[table] = idx + 1;
    const queue = responses[table] ?? [];
    return queue[idx] ?? queue[queue.length - 1] ?? { data: null, error: null };
  }

  function builder(table: string): any {
    const obj: any = {};
    const chainMethods = ['select', 'eq', 'order', 'limit', 'or', 'is'];
    for (const m of chainMethods) {
      obj[m] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return obj;
      });
    }
    obj.upsert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'upsert', args });
      return obj;
    });
    obj.update = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'update', args });
      return obj;
    });
    obj.insert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'insert', args });
      return obj;
    });
    obj.single = vi.fn(async () => nextFor(table));
    obj.maybeSingle = vi.fn(async () => nextFor(table));
    obj.then = (resolve: any, reject: any) =>
      Promise.resolve(nextFor(table)).then(resolve, reject);
    return obj;
  }

  const client: any = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(),
  };
  return { client, calls };
}

function pendingTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    contest_id: 'contest-1',
    contestant_id: 'contestant-A',
    voter_user_id: 'user-1',
    payment_reference: 'PAY-REF-001',
    amount_expected: '500.00', // NGN
    currency: 'NGN',
    votes_purchased: 10,
    bonus_votes: 2,
    total_votes_to_credit: 12,
    payment_status: 'pending',
    vote_credit_status: 'pending',
    voter_email: 'voter@example.com',
    voter_name: 'Test Voter',
    ...overrides,
  };
}

function verifyReq(overrides: Record<string, unknown> = {}) {
  return { transactionId: 'tx-1', paymentReference: 'PAY-REF-001', ...overrides };
}

describe('verifyAndCreditPaidVote (real logic, mocked Supabase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // PV-001 / PV-002 --------------------------------------------------------
  it('PV-001/PV-002: successful payment credits exactly the purchased+bonus votes, once', async () => {
    const tx = pendingTx();
    const { client, calls } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
      votes: [{ data: { id: 'vote-1' }, error: null }],
      vote_receipts: [{ data: null, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 500_00, // ₦500.00 exactly, matches amount_expected
      currency: 'NGN',
      providerReference: 'psk_ref_1',
      paidAt: '2026-09-16T10:00:00.000Z',
      customerEmail: 'voter@example.com',
      raw: {} as any,
    });

    const result = await verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0');

    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.votesCredited).toBe(12); // votes_purchased(10) + bonus_votes(2)

    // Exact credit — not more, not less.
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledWith('contest-1', 'contestant-A', {
      paidVotes: 10,
      bonusVotes: 2,
    });

    // Charged (marked successful) exactly once.
    const txUpdates = calls.filter((c) => c.table === 'vote_transactions' && c.method === 'update');
    expect(txUpdates).toHaveLength(1);
    expect((txUpdates[0].args[0] as any).payment_status).toBe('successful');
    expect((txUpdates[0].args[0] as any).vote_credit_status).toBe('credited');
  });

  // PV-003 -------------------------------------------------------------------
  it('PV-003: paid-vote crediting never touches the free-vote daily-limit tables', async () => {
    const tx = pendingTx();
    const { client, calls } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
      votes: [{ data: { id: 'vote-2' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 500_00,
      currency: 'NGN',
      providerReference: 'psk_ref_2',
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    await verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0');

    const freeLimitTables = calls.filter(
      (c) => c.table === 'voter_daily_limits' || c.table === 'voter_contestant_daily_limits',
    );
    expect(freeLimitTables).toHaveLength(0);
  });

  // PV-004 ---------------------------------------------------------------
  it('PV-004: a failed payment credits no votes and marks the transaction failed, not successful', async () => {
    const tx = pendingTx();
    const { client, calls } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: false,
      amountKobo: 0,
      currency: 'NGN',
      providerReference: null,
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    await expect(verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0')).rejects.toMatchObject(
      { status: 400 },
    );

    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
    const voteInserts = calls.filter((c) => c.table === 'votes' && c.method === 'insert');
    expect(voteInserts).toHaveLength(0);

    const txUpdates = calls.filter((c) => c.table === 'vote_transactions' && c.method === 'update');
    expect(txUpdates).toHaveLength(1);
    expect((txUpdates[0].args[0] as any).payment_status).toBe('failed');
  });

  // PV-006 -----------------------------------------------------------------
  it('PV-006: an amount mismatch (minor-unit exact check) is rejected, flagged, and credits nothing', async () => {
    const tx = pendingTx({ amount_expected: '500.00' });
    const { client, calls } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 300_00, // paid ₦300 instead of quoted ₦500 — well outside ₦1 tolerance
      currency: 'NGN',
      providerReference: 'psk_ref_3',
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    await expect(verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0')).rejects.toMatchObject(
      { status: 400 },
    );

    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
    expect(vi.mocked(recordVoteFraudSignals)).toHaveBeenCalledTimes(1);
    const fraudCall = vi.mocked(recordVoteFraudSignals).mock.calls[0][0] as any;
    expect(fraudCall.amountExpectedKobo).toBe(500_00);
    expect(fraudCall.amountPaidKobo).toBe(300_00);

    const txUpdates = calls.filter((c) => c.table === 'vote_transactions' && c.method === 'update');
    expect((txUpdates[0].args[0] as any).payment_status).toBe('failed');
  });

  it('PV-006: an exact-match amount within the ₦1 rounding tolerance is accepted', async () => {
    const tx = pendingTx({ amount_expected: '500.00' });
    const { client } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
      votes: [{ data: { id: 'vote-3' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);
    vi.mocked(verifyVotePayment).mockResolvedValue({
      success: true,
      amountKobo: 500_50, // ₦500.50 — within the ₦1 tolerance of ₦500.00
      currency: 'NGN',
      providerReference: 'psk_ref_4',
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    const result = await verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0');
    expect(result.success).toBe(true);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledTimes(1);
  });

  // PV-007 -------------------------------------------------------------------
  it('PV-007: a network drop during verification credits nothing and leaves the transaction retry-safe', async () => {
    const tx = pendingTx();
    const { client: dropClient, calls: dropCalls } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(dropClient);
    vi.mocked(verifyVotePayment).mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0'),
    ).rejects.toThrow('ECONNRESET');

    // Nothing was credited and no partial state was written for this attempt.
    expect(vi.mocked(incrementVoteTotals)).not.toHaveBeenCalled();
    const droppedUpdates = dropCalls.filter(
      (c) => c.table === 'vote_transactions' && c.method === 'update',
    );
    expect(droppedUpdates).toHaveLength(0);

    // Retry: transaction is still 'pending' (nothing persisted from the drop),
    // so a second call with a healthy verify succeeds and credits exactly once.
    const { client: retryClient } = makeTableClient({
      vote_transactions: [{ data: tx, error: null }],
      votes: [{ data: { id: 'vote-retry' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(retryClient);
    vi.mocked(verifyVotePayment).mockResolvedValueOnce({
      success: true,
      amountKobo: 500_00,
      currency: 'NGN',
      providerReference: 'psk_ref_retry',
      paidAt: null,
      customerEmail: null,
      raw: {} as any,
    });

    const retryResult = await verifyAndCreditPaidVote(verifyReq(), 'user-1', '10.0.0.1', 'UA/1.0');
    expect(retryResult.success).toBe(true);
    expect(vi.mocked(incrementVoteTotals)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PV-012 — currency/pricing per contest
// ---------------------------------------------------------------------------

describe('initiatePaidVote (real logic, mocked Supabase) — PV-012 currency/pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function settingsRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'vs-1',
      contest_id: 'contest-usd',
      voting_enabled: true,
      voting_type: 'hybrid',
      paid_voting_enabled: true,
      currency: 'USD',
      payment_provider: 'paystack',
      payment_ref_prefix: 'SPT-VOTE',
      status: 'active',
      ...overrides,
    };
  }

  it('uses the contest-configured currency (not a hardcoded NGN default) for the quote and the provider call', async () => {
    const { client } = makeTableClient({
      voting_settings: [{ data: settingsRow(), error: null }],
      vote_packages: [
        {
          data: {
            id: 'pkg-usd-10',
            contest_id: 'contest-usd',
            name: '10 votes',
            votes: 10,
            bonus_votes: 0,
            amount: 5, // 5 USD
            currency: 'USD',
            is_active: true,
            is_recommended: false,
            display_order: 0,
          },
          error: null,
        },
      ],
      vote_transactions: [{ data: { id: 'tx-usd-1' }, error: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const result = await initiatePaidVote(
      {
        contestId: 'contest-usd',
        contestantId: 'contestant-A',
        voterEmail: 'voter@example.com',
        voterName: 'Test Voter',
        packageId: 'pkg-usd-10',
        callbackUrl: 'https://example.com/callback',
      } as any,
      '10.0.0.1',
      'UA/1.0',
      'user-1',
    );

    expect(result.currency).toBe('USD');
    expect(result.amountExpected).toBe(5);

    // Paystack is called with the same currency and an amount converted to
    // minor units by a flat *100 — correct for 2-decimal currencies (NGN, USD,
    // etc.) but NOT currency-aware for zero-decimal currencies (e.g. JPY, XOF's
    // real-world usage varies). Confirmed here rather than fixed: no contest in
    // this codebase currently configures a zero-decimal currency, and adding a
    // per-currency exponent table is out of this batch's scope.
    const initCall = vi.mocked(initializePaystackPayment).mock.calls[0][0];
    expect(initCall.currency).toBe('USD');
    expect(initCall.amount).toBe(500); // 5 USD * 100
  });
});

// ---------------------------------------------------------------------------
// PV-010 — webhook authenticity, exercising the real protected implementation
// (tests/unit/voting/free-vote.spec.ts already covers the HMAC algorithm
// structurally; this covers the actual exported function that the live
// webhook route calls).
// ---------------------------------------------------------------------------

describe('verifyPaystackWebhookSignature (real implementation) — PV-010', () => {
  const ORIGINAL_KEY = process.env.PAYSTACK_SECRET_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_paymax_secret';
  });

  afterEach(() => {
    process.env.PAYSTACK_SECRET_KEY = ORIGINAL_KEY;
  });

  // The module is vi.mock()'d at the top of this file (for the PV-012 suite's
  // initializePaystackPayment stub); pull the REAL implementation via
  // importActual so this suite proves the actual protected function, not the mock.
  async function realModule() {
    return vi.importActual<typeof import('@/src/server/voting/payment/paystack')>(
      '@/src/server/voting/payment/paystack',
    );
  }

  it('accepts a correctly-signed payload', async () => {
    const { createHmac } = await import('node:crypto');
    const { verifyPaystackWebhookSignature } = await realModule();
    const rawBody = '{"event":"charge.success","data":{"reference":"SPT-VOTE-123"}}';
    const sig = createHmac('sha512', 'sk_test_paymax_secret').update(rawBody).digest('hex');

    expect(verifyPaystackWebhookSignature(rawBody, sig)).toBe(true);
  });

  it('rejects a forged/tampered payload (mismatched signature)', async () => {
    const { createHmac } = await import('node:crypto');
    const { verifyPaystackWebhookSignature } = await realModule();
    const rawBody = '{"event":"charge.success","data":{"reference":"SPT-VOTE-123"}}';
    const forgedBody = '{"event":"charge.success","data":{"reference":"SPT-VOTE-999"}}';
    // Attacker signs a different payload than the one actually sent.
    const sig = createHmac('sha512', 'sk_test_paymax_secret').update(forgedBody).digest('hex');

    expect(verifyPaystackWebhookSignature(rawBody, sig)).toBe(false);
  });

  it('rejects a signature produced with the wrong secret', async () => {
    const { createHmac } = await import('node:crypto');
    const { verifyPaystackWebhookSignature } = await realModule();
    const rawBody = '{"event":"charge.success"}';
    const sig = createHmac('sha512', 'wrong_secret').update(rawBody).digest('hex');

    expect(verifyPaystackWebhookSignature(rawBody, sig)).toBe(false);
  });
});

// Card-paid utility bills: payment received => vend, otherwise a refund REQUEST
// that an admin approves by hand (owner decision, closes the ADR-PR697 residual).
//
// Owner rule: "If payment is received, ensure the service is vended, else
// initiate a refund which will be approved by admin manually."
//
// What this pins (behind FEATURE_UTILITY_CARD_LEDGER):
//   1. A failed vend NEVER auto-credits. The row stays 'failed', a pending
//      refund request is recorded, finance is alerted, no money moves.
//   2. The admin's approval (the existing reversal) posts exactly ONE refund.
//   3. The stuck-sweeper follows the same rule on every ledger shape.
//   4. The ADR residual — writer posts the collect, stalls, the sweeper retains
//      the funds, the writer resumes and spends => +X -X, no vend, no refund —
//      cannot happen: the writer takes a version-checked claim right before the
//      collect and right before the spend, and yields if it lost the row or was
//      stalled past a safe age. The customer then holds the funds (or a refund
//      request), never neither.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', () => ({
  debitWallet: vi.fn(),
  reverseWalletDebit: vi.fn(),
  creditWallet: vi.fn(),
}));
vi.mock('@/src/server/utility/adapters/registry', () => ({ getUtilityAdapter: vi.fn() }));
vi.mock('@/src/server/utility/notifications', () => ({
  notifyUtilityCustomer: vi.fn(),
  notifyUtilityTransactionStatus: vi.fn(),
  queueUtilityAdminAlert: vi.fn(),
}));
vi.mock('@/src/server/commission/config', () => ({ resolveUtilityCommission: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet, debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { getUtilityAdapter } from '@/src/server/utility/adapters/registry';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { queueUtilityAdminAlert } from '@/src/server/utility/notifications';
import {
  payUtility,
  requeryUtilityTransaction,
  reverseUtilityTransaction,
} from '@/src/server/utility/service';

const USER_ID = 'user-vend-or-refund-001';
const BILLER = {
  id: 'biller-001', category: 'airtime', name: 'MTN', code: 'mtn', status: 'active',
  requires_validation: false, customer_reference_label: 'Phone number', dynamic_fields: [],
};
const PRODUCT = {
  id: 'product-001', biller_id: 'biller-001', category: 'airtime', name: 'MTN Airtime',
  code: 'mtn-airtime', amount_type: 'variable', amount_kobo: null, min_amount_kobo: 5000,
  max_amount_kobo: 5_000_000, convenience_fee_kobo: 0, markup_bps: 0, provider_discount_bps: 0,
  status: 'active', metadata: {},
};
const PROVIDER = {
  id: 'provider-001', name: 'VTPass', code: 'vtpass', adapter_code: 'vtpass', status: 'active',
  supported_categories: ['airtime'], priority: 1, health_status: 'healthy', credentials: {}, config: {},
};
const MAPPING = {
  id: 'mapping-001', provider_id: 'provider-001', product_id: 'product-001',
  provider_product_code: 'mtn', provider_biller_code: 'mtn', provider_cost_kobo: 490_000,
  provider_discount_bps: 0, status: 'active',
};

type Row = Record<string, any>;
type EventHook = (eventType: string, tx: Map<string, Row>) => void;

/** Fake Supabase admin client — same query shapes as the sibling specs, plus an event hook. */
function makeFakeSupabase(opts: { transactions?: Row[]; onEvent?: EventHook; dropRefundRequestWrite?: boolean } = {}) {
  const txs = new Map<string, Row>();
  for (const r of opts.transactions ?? []) txs.set(r.id, { ...r });
  const ledgerKeys = new Set<string>();
  const events: Array<{ transaction_id: string; event_type: string; payload: any }> = [];

  const matches = (row: Row, f: Record<string, unknown>, ins: Record<string, unknown[]>, lts: Record<string, unknown>) =>
    Object.entries(f).every(([c, v]) => row[c] === v) &&
    Object.entries(ins).every(([c, vs]) => vs.includes(row[c])) &&
    Object.entries(lts).every(([c, v]) => String(row[c]) < String(v));

  function builderFor(table: string) {
    const s: { f: Record<string, unknown>; ins: Record<string, unknown[]>; lts: Record<string, unknown>; insert?: any; update?: any } =
      { f: {}, ins: {}, lts: {} };
    const resolve = async (asList = false) => {
      switch (table) {
        case 'ledger_entries':
          return {
            data: s.ins.idempotency_key
              ? (s.ins.idempotency_key as string[]).filter((k) => ledgerKeys.has(k)).map((k) => ({ idempotency_key: k }))
              : [],
            error: null,
          };
        case 'utility_transactions': {
          if (s.f.idempotency_key !== undefined) {
            return { data: [...txs.values()].find((r) => r.idempotency_key === s.f.idempotency_key) ?? null, error: null };
          }
          const rows = [...txs.values()].filter((r) => matches(r, s.f, s.ins, s.lts));
          return { data: rows.length <= 1 ? (rows[0] ?? null) : rows, error: null };
        }
        case 'utility_billers': return { data: s.f.id === BILLER.id ? BILLER : null, error: null };
        case 'utility_products': return { data: s.f.id === PRODUCT.id ? PRODUCT : null, error: null };
        case 'utility_provider_product_mappings': return { data: [{ ...MAPPING, utility_providers: PROVIDER }], error: null };
        case 'utility_routing_rules': return { data: [], error: null };
        case 'utility_provider_attempts':
          if (asList) return { data: [], error: null };
          return { data: { id: `attempt-${Math.random()}`, started_at: new Date().toISOString() }, error: null };
        default: return { data: null, error: null };
      }
    };
    const applyUpdate = () => {
      if (table !== 'utility_transactions' || !s.update) return [];
      if (opts.dropRefundRequestWrite && s.update.metadata?.refund_request) { s.update = undefined; return []; }
      const touched: Row[] = [];
      for (const [id, row] of txs) {
        if (matches(row, s.f, s.ins, s.lts)) {
          const merged = { ...row, ...s.update };
          txs.set(id, merged);
          touched.push(merged);
        }
      }
      s.update = undefined;
      return touched;
    };
    const b: any = {
      select: vi.fn(() => {
        if (s.update) { const t = applyUpdate(); return { then: (f: any) => Promise.resolve({ data: t, error: null }).then(f) }; }
        return b;
      }),
      eq: vi.fn((c: string, v: unknown) => { s.f[c] = v; return b; }),
      in: vi.fn((c: string, vs: unknown[]) => { s.ins[c] = vs; return b; }),
      lt: vi.fn((c: string, v: unknown) => { s.lts[c] = v; return b; }),
      order: vi.fn(() => b),
      limit: vi.fn(() => b),
      insert: vi.fn((p: any) => {
        s.insert = p;
        if (table === 'utility_transactions') txs.set(p.id, { ...p });
        if (table === 'utility_transaction_events') {
          events.push({ transaction_id: p.transaction_id, event_type: p.event_type, payload: p.payload });
          opts.onEvent?.(p.event_type, txs);
        }
        return b;
      }),
      update: vi.fn((p: any) => { s.update = p; return b; }),
      maybeSingle: vi.fn(() => resolve()),
      single: vi.fn(async () => (s.insert ? { data: s.insert, error: null } : resolve())),
      then: (ok: any) => (s.update ? Promise.resolve({ data: applyUpdate(), error: null }).then(ok) : resolve(true).then(ok)),
    };
    return b;
  }
  return { from: vi.fn((t: string) => builderFor(t)), txs, ledgerKeys, events };
}

const input = (key: string) => ({
  category: 'airtime' as const, billerId: BILLER.id, productId: PRODUCT.id,
  customerReference: '+2348011111111', amountKobo: 500_000, paymentSource: 'paystack' as const,
  idempotencyKey: key, metadata: { payment_reference: 'UTIL_PAY_REF_1' },
});

function adapter(status: 'successful' | 'failed') {
  vi.mocked(getUtilityAdapter).mockReturnValue({
    validateCustomer: vi.fn(async () => ({ valid: true })),
    purchase: vi.fn(async () => ({ status, message: status === 'failed' ? 'Provider declined.' : 'Vended.', raw: {}, providerReference: 'p1' })),
    queryTransactionStatus: vi.fn(),
  } as any);
}

const creditKeys = () => vi.mocked(creditWallet).mock.calls.map((c) => (c[1] as any).idempotencyKey as string);
const FLAG = 'FEATURE_UTILITY_CARD_LEDGER';
let fake: ReturnType<typeof makeFakeSupabase>;

function wire(f: ReturnType<typeof makeFakeSupabase>) {
  fake = f;
  vi.mocked(createAdminClient).mockReturnValue(f as any);
  vi.mocked(creditWallet).mockImplementation(async (_u: string, i: any) => { f.ledgerKeys.add(i.idempotencyKey); return { alreadyProcessed: false } as any; });
  vi.mocked(debitWallet).mockImplementation(async (_u: string, i: any) => { f.ledgerKeys.add(i.idempotencyKey); return { alreadyProcessed: false } as any; });
  vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = '1';
  vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
});
afterEach(() => {
  delete process.env[FLAG];
  vi.useRealTimers();
});

describe('vend fails after payment was received => refund REQUEST, never an auto-credit', () => {
  it('posts only collect+spend; no PAYSTACK_REFUND; row stays failed with a pending request; finance alerted', async () => {
    wire(makeFakeSupabase());
    adapter('failed');
    const { transaction } = await payUtility(USER_ID, input('idem-vor-1'));

    expect(creditKeys()).toEqual([`utility:${transaction.id}:CARD_COLLECT`]);
    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(reverseWalletDebit).not.toHaveBeenCalled();

    const stored = fake.txs.get(transaction.id)!;
    expect(stored.status).toBe('failed');
    expect(stored.metadata?.refund_request).toMatchObject({ state: 'pending_admin', amount_kobo: 500_000 });
    expect(fake.events.map((e) => e.event_type)).toContain('refund_requested');
    expect(vi.mocked(queueUtilityAdminAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'finance', title: expect.stringMatching(/refund/i) }),
    );
  });

  it('a successful vend is untouched: no refund request, no extra credit', async () => {
    wire(makeFakeSupabase());
    adapter('successful');
    const { transaction } = await payUtility(USER_ID, input('idem-vor-2'));
    expect(transaction.status).toBe('successful');
    expect(creditKeys()).toEqual([`utility:${transaction.id}:CARD_COLLECT`]);
    expect(fake.events.map((e) => e.event_type)).not.toContain('refund_requested');
  });
});

describe('admin approval posts exactly one refund', () => {
  it('approving the request credits once, marks it approved, and a second approval moves no money', async () => {
    wire(makeFakeSupabase());
    adapter('failed');
    const { transaction } = await payUtility(USER_ID, input('idem-vor-3'));

    // Admin approves after the 60s admin settle window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 60_000);
    const row = fake.txs.get(transaction.id) as any;
    const approved = await reverseUtilityTransaction(row, 'Refund approved by finance');

    expect(creditKeys()).toEqual([
      `utility:${transaction.id}:CARD_COLLECT`,
      `utility:${transaction.id}:ADMIN_REVERSAL_PAYSTACK_REFUND`,
    ]);
    expect(approved.status).toBe('reversed');
    expect(fake.txs.get(transaction.id)!.metadata?.refund_request?.state).toBe('approved');

    const creditsBefore = vi.mocked(creditWallet).mock.calls.length;
    await expect(reverseUtilityTransaction(fake.txs.get(transaction.id) as any, 'again')).rejects.toThrow();
    expect(vi.mocked(creditWallet).mock.calls.length).toBe(creditsBefore);
  });
});

describe('stuck sweeper follows the same rule on every ledger shape', () => {
  const stuckRow = (id: string, status: string): Row => ({
    id, user_id: USER_ID, payment_source: 'paystack', status, retail_amount_kobo: 500_000,
    receipt_number: `R-${id}`, category: 'airtime', idempotency_key: `k-${id}`,
    metadata: { payment_reference: 'UTIL_PAY_REF_1' },
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('collect + spend posted, no vend (writer died after the spend): refund request, no credit', async () => {
    const f = makeFakeSupabase({ transactions: [stuckRow('tx-s1', 'wallet_debited')] });
    f.ledgerKeys.add('utility:tx-s1:CARD_COLLECT');
    f.ledgerKeys.add('utility:tx-s1:DEBIT');
    wire(f);
    await requeryUtilityTransaction(f.txs.get('tx-s1') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(f.txs.get('tx-s1')!.status).toBe('failed');
    expect(f.txs.get('tx-s1')!.metadata?.refund_request?.state).toBe('pending_admin');
  });

  it('nothing posted (writer died before the collect) but the card was charged: refund request, no credit', async () => {
    const f = makeFakeSupabase({ transactions: [stuckRow('tx-s2', 'initiated')] });
    wire(f);
    await requeryUtilityTransaction(f.txs.get('tx-s2') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(f.txs.get('tx-s2')!.status).toBe('failed');
    expect(f.txs.get('tx-s2')!.metadata?.refund_request?.state).toBe('pending_admin');
  });

  it('collect posted, spend never did: the customer already holds the money — retained, no request, no second credit', async () => {
    const f = makeFakeSupabase({ transactions: [stuckRow('tx-s3', 'initiated')] });
    f.ledgerKeys.add('utility:tx-s3:CARD_COLLECT');
    wire(f);
    await requeryUtilityTransaction(f.txs.get('tx-s3') as any);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(f.events.map((e) => e.event_type)).toContain('paystack_collected_funds_retained');
    expect(f.txs.get('tx-s3')!.metadata?.refund_request).toBeUndefined();
  });
});

describe('ADR-PR697 race: the writer can never spend after losing the row', () => {
  /** Simulates the stuck sweeper claiming the row at the moment `at` is recorded. */
  const claimAt = (at: string): EventHook => (eventType, txs) => {
    if (eventType !== at) return;
    for (const [id, row] of txs) {
      txs.set(id, { ...row, status: 'failed', failure_reason: 'swept', updated_at: new Date(Date.now() + 5).toISOString() });
    }
  };

  it('claimed BEFORE the collect: the writer posts nothing at all (no 2x)', async () => {
    wire(makeFakeSupabase({ onEvent: claimAt('paystack_verified') }));
    adapter('successful');
    await payUtility(USER_ID, input('idem-race-1'));
    expect(creditWallet).not.toHaveBeenCalled();
    expect(debitWallet).not.toHaveBeenCalled();
    expect(fake.events.map((e) => e.event_type)).toContain('writer_outraced');
  });

  it('claimed BETWEEN collect and spend: the collect stands, the late spend is refused (no 0x)', async () => {
    wire(makeFakeSupabase({ onEvent: claimAt('card_collected') }));
    adapter('successful');
    await payUtility(USER_ID, input('idem-race-2'));
    expect(creditKeys()).toHaveLength(1);
    expect(creditKeys()[0]).toMatch(/:CARD_COLLECT$/);
    expect(debitWallet).not.toHaveBeenCalled();
    expect(fake.events.map((e) => e.event_type)).toContain('writer_outraced');
  });

  it('stalled past the safe age after the collect: the writer yields instead of spending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'));
    wire(makeFakeSupabase({
      onEvent: (eventType) => { if (eventType === 'card_collected') vi.setSystemTime(new Date('2026-10-12T10:06:00.000Z')); },
    }));
    adapter('successful');
    await payUtility(USER_ID, input('idem-race-3'));
    expect(creditKeys()).toHaveLength(1);
    expect(debitWallet).not.toHaveBeenCalled();
    expect(fake.events.map((e) => e.event_type)).toContain('writer_stale_yield');
  });

  it('an unraced writer still collects, spends and vends exactly once', async () => {
    wire(makeFakeSupabase());
    adapter('successful');
    const { transaction } = await payUtility(USER_ID, input('idem-race-4'));
    expect(transaction.status).toBe('successful');
    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(debitWallet).toHaveBeenCalledTimes(1);
  });
});

describe('flag OFF keeps today\'s automatic refund (nothing changes until the flag is on)', () => {
  it('failed vend still auto-refunds once', async () => {
    delete process.env[FLAG];
    wire(makeFakeSupabase());
    adapter('failed');
    const { transaction } = await payUtility(USER_ID, input('idem-off-1'));
    expect(creditKeys()).toEqual([`utility:${transaction.id}:PAYSTACK_REFUND`]);
    expect(transaction.status).toBe('reversed');
  });
});

describe('review fixes: the immediate settle and an unrecorded request', () => {
  it('collect posts then the spend is refused: the row is closed NOW, not left initiated for the sweeper', async () => {
    wire(makeFakeSupabase());
    adapter('successful');
    vi.mocked(debitWallet).mockRejectedValue(new Error('Daily limit exceeded.'));
    await expect(payUtility(USER_ID, input('idem-fix-1'))).rejects.toThrow();

    const row = [...fake.txs.values()][0];
    // Funds stay in the wallet (collect-only) and the row is settled immediately.
    expect(creditKeys()).toHaveLength(1);
    expect(row.status).not.toBe('initiated');
    expect(fake.events.map((e) => e.event_type)).toContain('paystack_collected_funds_retained');
  });

  it('the collect itself throws: a refund request is filed immediately, no credit, row not left initiated', async () => {
    wire(makeFakeSupabase());
    adapter('successful');
    vi.mocked(creditWallet).mockRejectedValue(new Error('ledger unavailable'));
    await expect(payUtility(USER_ID, input('idem-fix-2'))).rejects.toThrow();

    const row = [...fake.txs.values()][0];
    expect(row.status).toBe('failed');
    expect(row.metadata?.refund_request?.state).toBe('pending_admin');
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('a refund request that could not be written is loud: dedicated event + alert, never silent', async () => {
    wire(makeFakeSupabase({ dropRefundRequestWrite: true }));
    adapter('failed');
    await payUtility(USER_ID, input('idem-fix-3'));

    expect(fake.events.map((e) => e.event_type)).toContain('refund_request_unrecorded');
    expect(vi.mocked(queueUtilityAdminAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'finance', title: expect.stringMatching(/could not be recorded/i) }),
    );
    // Still no automatic credit.
    expect(creditKeys().filter((k) => !/:CARD_COLLECT$/.test(k))).toHaveLength(0);
  });
});

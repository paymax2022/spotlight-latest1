// Ledger-auditor findings on ADR-PR697 (card-paid utility bills reach the ledger).
// payUtility now throws AFTER a utility_transactions row exists and money has
// been collected, so the callers that assumed "any throw = nothing was ever
// posted" would pay the customer twice:
//   - verifyUtilityPaystackPayment's catch posts VALIDATION_REFUND on any throw;
//   - reverseUtilityTransaction credits a collect-only row on top of funds the
//     wallet already holds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  debitWallet: vi.fn(),
  reverseWalletDebit: vi.fn(),
  creditWallet: vi.fn(),
}));

vi.mock('@/src/server/utility/adapters/registry', () => ({
  getUtilityAdapter: vi.fn(),
}));

vi.mock('@/src/server/utility/notifications', () => ({
  notifyUtilityCustomer: vi.fn(),
  notifyUtilityTransactionStatus: vi.fn(),
  queueUtilityAdminAlert: vi.fn(),
}));

vi.mock('@/src/server/commission/config', () => ({
  resolveUtilityCommission: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet, debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { getUtilityAdapter } from '@/src/server/utility/adapters/registry';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { payUtility, reverseUtilityTransaction } from '@/src/server/utility/service';

const USER_ID = 'user-utility-refund-001';
const BILLER_ID = 'biller-001';
const PRODUCT_ID = 'product-001';
const PROVIDER_ID = 'provider-001';
const MAPPING_ID = 'mapping-001';

const BILLER = {
  id: BILLER_ID,
  category: 'airtime',
  name: 'MTN',
  code: 'mtn',
  status: 'active',
  requires_validation: false,
  customer_reference_label: 'Phone number',
  dynamic_fields: [],
};

const PRODUCT = {
  id: PRODUCT_ID,
  biller_id: BILLER_ID,
  category: 'airtime',
  name: 'MTN Airtime',
  code: 'mtn-airtime',
  amount_type: 'variable',
  amount_kobo: null,
  min_amount_kobo: 5000,
  max_amount_kobo: 5_000_000,
  convenience_fee_kobo: 0,
  markup_bps: 0,
  provider_discount_bps: 0,
  status: 'active',
  metadata: {},
};

const PROVIDER = {
  id: PROVIDER_ID,
  name: 'VTPass',
  code: 'vtpass',
  adapter_code: 'vtpass',
  status: 'active',
  supported_categories: ['airtime'],
  priority: 1,
  health_status: 'healthy',
  credentials: {},
  config: {},
};

const MAPPING = {
  id: MAPPING_ID,
  provider_id: PROVIDER_ID,
  product_id: PRODUCT_ID,
  provider_product_code: 'mtn',
  provider_biller_code: 'mtn',
  provider_cost_kobo: 490_000,
  provider_discount_bps: 0,
  status: 'active',
};

/**
 * A minimal fake Supabase admin client covering exactly the query shapes
 * `payUtility` issues. `utility_transactions` is the only table tracked
 * statefully (keyed by id) because the test asserts on its FINAL status after
 * two updates (provider-failed, then refund) — every other table is read-only
 * canned fixture data.
 */
function makeFakeSupabase(opts: { ledgerKeys?: string[]; transactions?: Record<string, unknown>[] } = {}) {
  const transactionsById = new Map<string, Record<string, unknown>>();
  for (const row of opts.transactions ?? []) transactionsById.set(row.id as string, { ...row });
  // ledger_entries is modelled as a set of posted idempotency keys — the
  // AUD-BILL-005 money-leg probe selects keys `.in(...)` against it.
  const ledgerKeys = new Set(opts.ledgerKeys ?? []);

  function findByIdempotencyKey(key: unknown) {
    for (const row of transactionsById.values()) {
      if (row.idempotency_key === key) return row;
    }
    return null;
  }

  // AUD-BILL-005: updates are CAS-guarded — eq/in/lt filters must ALL match the
  // stored row before an update applies, so the fake models them faithfully.
  function matches(
    row: Record<string, unknown>,
    filters: Record<string, unknown>,
    ins: Record<string, unknown[]>,
    lts: Record<string, unknown>,
  ) {
    for (const [col, val] of Object.entries(filters)) {
      if (row[col] !== val) return false;
    }
    for (const [col, vals] of Object.entries(ins)) {
      if (!vals.includes(row[col])) return false;
    }
    for (const [col, val] of Object.entries(lts)) {
      if (!(String(row[col]) < String(val))) return false;
    }
    return true;
  }

  function builderFor(table: string) {
    const state: {
      filters: Record<string, unknown>;
      ins: Record<string, unknown[]>;
      lts: Record<string, unknown>;
      insertPayload?: any;
      updatePayload?: any;
    } = { filters: {}, ins: {}, lts: {} };

    const resolve = async () => {
      switch (table) {
        case 'ledger_entries':
          if (state.ins.idempotency_key) {
            return {
              data: (state.ins.idempotency_key as string[]).filter((k) => ledgerKeys.has(k)).map((k) => ({ idempotency_key: k })),
              error: null,
            };
          }
          return { data: [], error: null };
        case 'utility_transactions': {
          const rows = [...transactionsById.values()].filter((row) => matches(row, state.filters, state.ins, state.lts));
          if (state.filters.idempotency_key !== undefined) {
            return { data: findByIdempotencyKey(state.filters.idempotency_key), error: null };
          }
          return { data: rows.length <= 1 ? (rows[0] ?? null) : rows, error: null };
        }
        case 'utility_billers':
          return { data: state.filters.id === BILLER_ID ? BILLER : null, error: null };
        case 'utility_products':
          return { data: state.filters.id === PRODUCT_ID ? PRODUCT : null, error: null };
        case 'utility_provider_product_mappings':
          return { data: [{ ...MAPPING, utility_providers: PROVIDER }], error: null };
        case 'utility_routing_rules':
          return { data: [], error: null };
        case 'utility_category_settings':
          return { data: null, error: null };
        case 'utility_provider_attempts':
          return {
            data: { id: `attempt-${Math.random()}`, started_at: new Date().toISOString() },
            error: null,
          };
        case 'utility_transaction_events':
          return { data: null, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const applyUpdate = () => {
      if (table !== 'utility_transactions' || !state.updatePayload) return [];
      const touched: Array<Record<string, unknown>> = [];
      for (const [id, row] of transactionsById) {
        if (matches(row, state.filters, state.ins, state.lts)) {
          const merged = { ...row, ...state.updatePayload };
          transactionsById.set(id, merged);
          touched.push(merged);
        }
      }
      state.updatePayload = undefined;
      return touched;
    };

    const builder: any = {
      select: vi.fn(() => {
        if (state.updatePayload) {
          const touched = applyUpdate();
          return { then: (f: any) => Promise.resolve({ data: touched, error: null }).then(f) };
        }
        return builder;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        state.filters[col] = val;
        return builder;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        state.ins[col] = vals;
        return builder;
      }),
      lt: vi.fn((col: string, val: unknown) => {
        state.lts[col] = val;
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((payload: any) => {
        state.insertPayload = payload;
        if (table === 'utility_transactions') {
          transactionsById.set(payload.id, { ...payload });
        }
        return builder;
      }),
      update: vi.fn((payload: any) => {
        state.updatePayload = payload;
        return builder;
      }),
      maybeSingle: vi.fn(() => resolve()),
      single: vi.fn(async () => {
        if (state.insertPayload) return { data: state.insertPayload, error: null };
        return resolve();
      }),
      then: (onFulfilled: any) => {
        if (state.updatePayload) return Promise.resolve({ data: applyUpdate(), error: null }).then(onFulfilled);
        return resolve().then(onFulfilled);
      },
    };

    return builder;
  }

  return {
    from: vi.fn((table: string) => builderFor(table)),
    _transactionsById: transactionsById,
    _ledgerKeys: ledgerKeys,
  };
}

function inputFor(paymentSource: 'wallet' | 'paystack', idempotencyKey: string) {
  return {
    category: 'airtime' as const,
    billerId: BILLER_ID,
    productId: PRODUCT_ID,
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    paymentSource,
    idempotencyKey,
    metadata: { payment_reference: 'UTIL_TEST123' },
  };
}

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

import { ApiError } from '@/src/lib/api/responses';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { verifyUtilityPaystackPayment } from '@/app/api/v1/utility/paystack/_service';

const FLAG = 'FEATURE_UTILITY_CARD_LEDGER';
const REFERENCE = 'UTIL_VERIFY_REF1';

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-900',
    user_id: USER_ID,
    category: 'airtime',
    biller_id: BILLER_ID,
    product_id: PRODUCT_ID,
    customer_reference: '+2348011111111',
    amount_kobo: 500_000,
    retail_amount_kobo: 500_000,
    payment_reference: REFERENCE,
    status: 'pending',
    transaction_id: null,
    metadata: {},
    ...overrides,
  };
}

/** The base fake knows every utility table; add the intents table on top. */
function makeFake(intentOverrides: Record<string, unknown> = {}, base = makeFakeSupabase()) {
  const state = { intent: makeIntent(intentOverrides) as Record<string, unknown> };
  const intentBuilder: any = {
    select: vi.fn(() => intentBuilder),
    eq: vi.fn(() => intentBuilder),
    update: vi.fn((payload: any) => {
      state.intent = { ...state.intent, ...payload };
      return intentBuilder;
    }),
    maybeSingle: vi.fn(async () => ({ data: state.intent, error: null })),
    then: (f: any) => Promise.resolve({ data: null, error: null }).then(f),
  };
  return {
    from: vi.fn((table: string) => (table === 'utility_paystack_intents' ? intentBuilder : base.from(table))),
    _ledgerKeys: base._ledgerKeys,
    _transactionsById: base._transactionsById,
    _intent: state,
  };
}

function wireWalletToLedger(fake: { _ledgerKeys: Set<string> }) {
  vi.mocked(creditWallet).mockImplementation(async (_u: string, input: any) => {
    fake._ledgerKeys.add(input.idempotencyKey);
    return { alreadyProcessed: false, amountKobo: 500_000 } as any;
  });
  vi.mocked(debitWallet).mockImplementation(async (_u: string, input: any) => {
    fake._ledgerKeys.add(input.idempotencyKey);
    return { alreadyProcessed: false, amountKobo: 500_000 } as any;
  });
}

function creditKeys() {
  return vi.mocked(creditWallet).mock.calls.map((c) => (c[1] as any).idempotencyKey as string);
}

describe('verifyUtilityPaystackPayment + payUtility (flag ON) — one card charge is never refunded twice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[FLAG] = '1';
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true, amountKobo: 500_000, providerReference: 'ps-1',
    } as any);
    vi.mocked(getUtilityAdapter).mockReturnValue({
      validateCustomer: vi.fn(async () => ({ valid: true })),
      purchase: vi.fn(async () => ({ status: 'successful', message: 'Vended.', raw: {}, providerReference: 'p1' })),
      queryTransactionStatus: vi.fn(),
    } as any);
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it('spend refused (tier/limit): the collected funds stay put — NO VALIDATION_REFUND on top', async () => {
    const fake = makeFake();
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    wireWalletToLedger(fake);
    vi.mocked(debitWallet).mockRejectedValue(new ApiError('Daily limit exceeded.', 403));

    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();

    expect(creditKeys()).toHaveLength(1);
    expect(creditKeys()[0]).toMatch(/:CARD_COLLECT$/);
    expect(fake._intent.intent.status).toBe('failed');
  });

  it('collect itself fails: NO immediate credit under any key — the retry window opens', async () => {
    const fake = makeFake();
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    wireWalletToLedger(fake);
    vi.mocked(creditWallet).mockImplementation(async (_u: string, input: any) => {
      if (/:CARD_COLLECT$/.test(input.idempotencyKey)) throw new Error('ledger unavailable');
      fake._ledgerKeys.add(input.idempotencyKey);
      return { alreadyProcessed: false, amountKobo: 500_000 } as any;
    });

    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();

    // Owner rule (ADR-PR701): payment received, service not delivered => the retry
    // window opens, and the refund (if vending keeps failing) comes from the worker
    // 30 minutes later. Neither PAYSTACK_REFUND nor VALIDATION_REFUND may post now:
    // two different keys would pay the customer twice. The worker's refund is pinned
    // in vend-retry-flow.spec.ts.
    const posted = creditKeys().filter((k) => !/:CARD_COLLECT$/.test(k));
    expect(posted).toHaveLength(0);
  });

  it('the existence probe errors: do NOT refund blind — a row may exist and own the money', async () => {
    const fake = makeFake({ biller_id: 'no-such-biller' });
    const realFrom = fake.from;
    fake.from = vi.fn((table: string) => {
      if (table !== 'utility_transactions') return realFrom(table);
      const failing: any = {
        select: vi.fn(() => failing),
        eq: vi.fn(() => failing),
        maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'connection reset' } })),
      };
      return failing;
    }) as any;
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    wireWalletToLedger(fake);

    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();

    // A transient read error must not read as "no row": that would post
    // VALIDATION_REFUND on top of whatever payUtility already settled.
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('validation fails BEFORE any row exists: still refunded exactly once (unchanged)', async () => {
    const fake = makeFake({ biller_id: 'no-such-biller' });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    wireWalletToLedger(fake);

    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();

    expect(creditKeys()).toHaveLength(1);
    expect(creditKeys()[0]).toMatch(/:VALIDATION_REFUND$/);
  });
});

describe('reverseUtilityTransaction — a collect-only row must not be credited again', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[FLAG] = '1';
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('collect posted, spend never did: converge the status, post no money', async () => {
    const row = {
      id: 'tx-collect-only',
      user_id: USER_ID,
      status: 'failed',
      payment_source: 'paystack',
      idempotency_key: 'idem-collect-only',
      retail_amount_kobo: 500_000,
      receipt_number: 'UTL-COLLECT-ONLY',
      category: 'airtime',
      metadata: { payment_reference: REFERENCE },
      updated_at: '2020-01-01T00:00:00.000Z',
    };
    const base = makeFakeSupabase({
      transactions: [row],
      ledgerKeys: ['utility:tx-collect-only:CARD_COLLECT'],
    });
    vi.mocked(createAdminClient).mockReturnValue(base as any);

    await reverseUtilityTransaction(row as any, 'support request');

    expect(creditWallet).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

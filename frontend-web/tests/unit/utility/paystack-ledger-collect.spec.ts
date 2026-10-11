// Card-paid utility bills must reach the ledger (ADR-PR<pr> — card-paid utility
// bills are collected into the wallet, then spent). Before this, a verified
// Paystack charge (paymentSource: 'paystack') posted NOTHING: the admin
// Transactions page (ledger_entries only) never showed it, and every refund path
// credited the wallet against money the ledger had never received.
//
// Design pinned here (behind FEATURE_UTILITY_CARD_LEDGER, default off):
//   collect  creditWallet  key utility:<tx>:CARD_COLLECT   reference = receipt
//   spend    debitWallet   key utility:<tx>:DEBIT          (same as wallet source)
//   refund   unchanged     key utility:<tx>:PAYSTACK_REFUND, but ONLY when the
//            spend posted — if the spend was refused the wallet still holds the
//            collected funds and a second credit would pay the customer twice.
// The collect credit must NOT carry the Paystack payment_reference as its
// `reference`: lookupUtilityMoneyLegs treats any CREDIT with that reference as
// "refund already posted", which would suppress a real refund.
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

import { ApiError } from '@/src/lib/api/responses';

const FLAG = 'FEATURE_UTILITY_CARD_LEDGER';
const PAYMENT_REF = 'UTIL_TEST123';

function adapterThatVends(status: 'successful' | 'failed') {
  vi.mocked(getUtilityAdapter).mockReturnValue({
    validateCustomer: vi.fn(async () => ({ valid: true })),
    purchase: vi.fn(async () => ({
      status,
      message: status === 'failed' ? 'Provider declined.' : 'Vended.',
      raw: {},
      providerReference: 'prov-ref-1',
    })),
    queryTransactionStatus: vi.fn(),
  } as any);
}

function creditKeys() {
  return vi.mocked(creditWallet).mock.calls.map((c) => (c[1] as any).idempotencyKey as string);
}

describe('payUtility — card-paid bills reach the ledger (flag ON)', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[FLAG] = '1';
    fakeSupabase = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it('success: collects the card money into the wallet, then spends it, in that order', async () => {
    adapterThatVends('successful');
    const { transaction } = await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-1'));

    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${transaction.id}:CARD_COLLECT`,
    }));
    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(debitWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${transaction.id}:DEBIT`,
    }));

    const collectAt = vi.mocked(creditWallet).mock.invocationCallOrder[0];
    const debitAt = vi.mocked(debitWallet).mock.invocationCallOrder[0];
    expect(collectAt).toBeLessThan(debitAt);
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('the collect credit never reuses the Paystack payment_reference as its ledger reference', async () => {
    adapterThatVends('successful');
    await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-2'));
    const collect = vi.mocked(creditWallet).mock.calls[0][1] as any;
    expect(collect.reference).toBeTruthy();
    expect(collect.reference).not.toBe(PAYMENT_REF);
  });

  it('vend fails: collect, spend, then ONE refund — the customer ends with exactly their money back', async () => {
    adapterThatVends('failed');
    const { transaction } = await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-3'));

    expect(creditKeys()).toEqual([
      `utility:${transaction.id}:CARD_COLLECT`,
      `utility:${transaction.id}:PAYSTACK_REFUND`,
    ]);
    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(transaction.status).toBe('reversed');
  });

  it('spend refused (tier/limit): the collected funds stay in the wallet and NO second credit is paid', async () => {
    adapterThatVends('successful');
    vi.mocked(debitWallet).mockRejectedValue(new ApiError('Daily limit exceeded.', 403));

    await expect(payUtility(USER_ID, inputFor('paystack', 'idem-ledger-4'))).rejects.toThrow();

    // Exactly one credit in total: the collection. A PAYSTACK_REFUND here would
    // credit the customer twice for one card charge.
    expect(creditKeys()).toHaveLength(1);
    expect(creditKeys()[0]).toMatch(/:CARD_COLLECT$/);
  });

  it('replay with the same idempotency key touches the wallet zero further times', async () => {
    adapterThatVends('successful');
    await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-5'));
    vi.mocked(creditWallet).mockClear();
    vi.mocked(debitWallet).mockClear();

    const second = await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-5'));
    expect(second.alreadyProcessed).toBe(true);
    expect(creditWallet).not.toHaveBeenCalled();
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('wallet-sourced payments are untouched by the flag (no collect credit)', async () => {
    adapterThatVends('successful');
    await payUtility(USER_ID, inputFor('wallet', 'idem-ledger-6'));
    expect(creditWallet).not.toHaveBeenCalled();
    expect(debitWallet).toHaveBeenCalledTimes(1);
  });
});

describe('payUtility — card-paid bills (flag OFF, today\'s behaviour is preserved)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[FLAG];
    vi.mocked(createAdminClient).mockReturnValue(makeFakeSupabase() as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
  });

  it('success posts nothing to the wallet/ledger', async () => {
    adapterThatVends('successful');
    await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-7'));
    expect(creditWallet).not.toHaveBeenCalled();
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('vend failure still refunds exactly once, with no collect leg', async () => {
    adapterThatVends('failed');
    const { transaction } = await payUtility(USER_ID, inputFor('paystack', 'idem-ledger-8'));
    expect(creditKeys()).toEqual([`utility:${transaction.id}:PAYSTACK_REFUND`]);
    expect(debitWallet).not.toHaveBeenCalled();
  });
});

// Pins the fix for a real incident (2026-09-17): a utility payment funded via a
// verified Paystack charge (paymentSource: 'paystack') whose downstream provider
// vend fails leaves the customer's money captured with NOTHING refunded — no
// wallet credit, no ledger entry. The sibling `paymentSource: 'wallet'` path
// already reverses correctly (see the second describe block, a regression guard
// for that existing behaviour). See frontend-web/src/server/utility/service.ts
// `payUtility`'s failure branch (around line 728).
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('payUtility — Paystack-funded payment, provider vend fails', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(getUtilityAdapter).mockReturnValue({
      validateCustomer: vi.fn(async () => ({ valid: true })),
      purchase: vi.fn(async () => ({
        status: 'failed',
        message: 'Sandbox: meter not recognised (use 1111111111111 / 1010101010101).',
        raw: {},
      })),
      queryTransactionStatus: vi.fn(),
    } as any);
  });

  it('refunds the captured Paystack amount into the wallet', async () => {
    const { transaction } = await payUtility(USER_ID, inputFor('paystack', 'idem-paystack-1'));

    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${transaction.id}:PAYSTACK_REFUND`,
    }));

    // The debit/reverse-debit helpers are for the WALLET path only — a Paystack
    // charge was never a wallet debit, so neither must be touched here.
    expect(debitWallet).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('marks the transaction reversed (not left as a bare "failed") once refunded', async () => {
    const { transaction } = await payUtility(USER_ID, inputFor('paystack', 'idem-paystack-2'));
    expect(transaction.status).toBe('reversed');
  });

  it('is idempotent on retry (same idempotency key never double-refunds)', async () => {
    const idempotencyKey = 'idem-paystack-3';
    await payUtility(USER_ID, inputFor('paystack', idempotencyKey));

    // Second call with the same idempotency key hits the duplicate-transaction
    // guard at the top of payUtility and must not touch the wallet again.
    vi.mocked(creditWallet).mockClear();
    const second = await payUtility(USER_ID, inputFor('paystack', idempotencyKey));
    expect(second.alreadyProcessed).toBe(true);
    expect(creditWallet).not.toHaveBeenCalled();
  });
});

describe('payUtility — wallet-funded payment, provider vend fails (regression guard)', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(getUtilityAdapter).mockReturnValue({
      validateCustomer: vi.fn(async () => ({ valid: true })),
      purchase: vi.fn(async () => ({
        status: 'failed',
        message: 'Provider unavailable.',
        raw: {},
      })),
      queryTransactionStatus: vi.fn(),
    } as any);
  });

  it('still reverses the wallet debit, unchanged by the Paystack fix', async () => {
    const { transaction } = await payUtility(USER_ID, inputFor('wallet', 'idem-wallet-1'));

    expect(debitWallet).toHaveBeenCalledTimes(1);
    expect(reverseWalletDebit).toHaveBeenCalledTimes(1);
    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${transaction.id}:REVERSAL_DEBIT`,
    }));
    expect(creditWallet).not.toHaveBeenCalled();
    expect(transaction.status).toBe('reversed');
  });
});

describe('reverseUtilityTransaction — admin-triggered reversal, payment_source aware', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(debitWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
  });

  // AUD-BILL-005: admin reversal now CAS-claims the row (a 'failed' row must be
  // older than the 60s settle window) — the fixture is stale and seeded into
  // the fake table.
  const STALE = new Date(Date.now() - 15 * 60_000).toISOString();
  function rowFor(paymentSource: 'wallet' | 'paystack') {
    return {
      id: 'tx-admin-001',
      user_id: USER_ID,
      status: 'failed',
      payment_source: paymentSource,
      retail_amount_kobo: 500_000,
      receipt_number: 'UTL-ADMIN-001',
      idempotency_key: 'idem-admin-001',
      metadata: {},
      created_at: STALE,
      updated_at: STALE,
    } as any;
  }

  it('reverses the wallet debit for a wallet-funded transaction (unchanged behaviour)', async () => {
    // AUD-BILL-005: the admin path now proves the debit leg exists before
    // reversing — this fixture carries it.
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ transactions: [rowFor('wallet')], ledgerKeys: ['utility:tx-admin-001:DEBIT'] }) as any,
    );
    await reverseUtilityTransaction(rowFor('wallet'), 'customer requested cancellation');

    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: 'utility:tx-admin-001:ADMIN_REVERSAL_DEBIT',
    }));
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('credits the wallet (never reverseWalletDebit) for a Paystack-funded transaction — it was never debited', async () => {
    const tx = rowFor('paystack');
    tx.metadata = { payment_reference: 'UTIL_ADMIN_REF' };
    vi.mocked(createAdminClient).mockReturnValue(makeFakeSupabase({ transactions: [tx] }) as any);
    await reverseUtilityTransaction(tx, 'stuck transaction investigated by finance');

    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: 'utility:tx-admin-001:ADMIN_REVERSAL_PAYSTACK_REFUND',
    }));
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

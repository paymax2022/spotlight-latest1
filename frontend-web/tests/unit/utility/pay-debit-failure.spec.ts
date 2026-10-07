// payUtility — wallet-debit failure closes the transaction 'failed' NOW.
//
// Before the fix, a debit that refused (insufficient funds / tier limit)
// threw out of payUtility with the utility_transactions row left at
// 'initiated'. The 10-minute stuck-transaction sweep was the only cleanup,
// so the user's transaction list + receipt showed a phantom pending payment,
// and a same-key idempotent replay returned already_processed:true with that
// phantom 'initiated' row instead of the real failure. The Go plane closes
// the row immediately (backend/internal/utilitybills PayUtility → markFailed);
// the TS plane now settles it through settleFailedUtilityTransaction — which
// ALSO reverses the debit when the leg posted ambiguously.
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
import { debitWallet, reverseWalletDebit } from '@/src/server/wallet/service';
import { getUtilityAdapter } from '@/src/server/utility/adapters/registry';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { payUtility } from '@/src/server/utility/service';

const USER_ID = 'user-debit-fail-001';
const PROVIDER_ID = 'provider-001';
const BILLER_ID = 'biller-001';
const PRODUCT_ID = 'product-001';
const MAPPING_ID = 'mapping-001';

const BILLER = {
  id: BILLER_ID,
  category: 'airtime',
  name: 'MTN',
  code: 'mtn',
  status: 'active',
  requires_validation: false,
  customer_reference_label: 'Phone number',
};

const PRODUCT = {
  id: PRODUCT_ID,
  biller_id: BILLER_ID,
  category: 'airtime',
  name: 'MTN Airtime',
  code: 'mtn-airtime',
  amount_type: 'variable',
  amount_kobo: null,
  min_amount_kobo: 5_000,
  max_amount_kobo: 5_000_000,
  convenience_fee_kobo: 0,
  markup_bps: 0,
  status: 'active',
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

// Same fake shape as paystack-refund.spec.ts: CAS-guarded updates modelled
// faithfully; ledger_entries is a set of posted idempotency keys the
// AUD-BILL-005 money-leg probe checks .in(...) against.
function makeFakeSupabase(opts: { ledgerKeys?: Set<string> } = {}) {
  const transactionsById = new Map<string, Record<string, unknown>>();
  const ledgerKeys = opts.ledgerKeys ?? new Set<string>();
  const events: Array<Record<string, unknown>> = [];

  function findByIdempotencyKey(key: unknown) {
    for (const row of transactionsById.values()) {
      if (row.idempotency_key === key) return row;
    }
    return null;
  }

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
        case 'utility_category_settings':
          return { data: table === 'utility_routing_rules' ? [] : null, error: null };
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
      neq: vi.fn((col: string, val: unknown) => builder),
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
        if (table === 'utility_transaction_events') {
          events.push({ ...payload });
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
    _events: events,
  };
}

function inputFor(idempotencyKey: string) {
  return {
    category: 'airtime' as const,
    billerId: BILLER_ID,
    productId: PRODUCT_ID,
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    paymentSource: 'wallet' as const,
    idempotencyKey,
    metadata: {},
  };
}

describe('payUtility — wallet debit refuses before any provider call', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(getUtilityAdapter).mockReturnValue({
      validateCustomer: vi.fn(async () => ({ valid: true })),
      purchase: vi.fn(),
      queryTransactionStatus: vi.fn(),
    } as any);
  });

  it('marks the transaction failed (not initiated) and rethrows the real debit error', async () => {
    const insufficient = Object.assign(new Error('Insufficient wallet balance. Required: 500000 kobo.'), { status: 402 });
    vi.mocked(debitWallet).mockRejectedValueOnce(insufficient);

    await expect(payUtility(USER_ID, inputFor('idem-debit-fail-1'))).rejects.toBe(insufficient);

    const rows = [...fakeSupabase._transactionsById.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].failure_reason).toContain('Insufficient wallet balance');

    // The failure is on the immutable event trail — same event type the Go
    // plane emits (wallet_debit_failed).
    expect(fakeSupabase._events.some((e) => e.event_type === 'wallet_debit_failed')).toBe(true);
    // No provider attempt and no reversal — nothing was posted to reverse.
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('reverses immediately when the debit leg posted ambiguously (threw after commit)', async () => {
    // debitWallet "posts" the ledger leg then throws (response lost): the
    // settle path's ledger-leg probe must find it and compensate in-line.
    vi.mocked(debitWallet).mockImplementationOnce(async (_uid: string, input: { idempotencyKey: string }) => {
      fakeSupabase._ledgerKeys.add(input.idempotencyKey);
      throw new Error('wallet service: upstream timeout');
    });

    await expect(payUtility(USER_ID, inputFor('idem-debit-fail-2'))).rejects.toThrow('upstream timeout');

    const rows = [...fakeSupabase._transactionsById.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('reversed');
    expect(reverseWalletDebit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reverseWalletDebit).mock.calls[0][1].idempotencyKey).toContain('REVERSAL_DEBIT');
  });

  it('same-key replay after a debit refusal reports the failed row, not a phantom initiated', async () => {
    const insufficient = Object.assign(new Error('Insufficient wallet balance.'), { status: 402 });
    vi.mocked(debitWallet).mockRejectedValueOnce(insufficient);

    await expect(payUtility(USER_ID, inputFor('idem-debit-fail-3'))).rejects.toBe(insufficient);

    // Second call with the same key: idempotency pre-check returns the stored
    // row — 'failed' is not in the requery set, so it comes back as-is.
    const replay = await payUtility(USER_ID, inputFor('idem-debit-fail-3'));
    expect(replay.alreadyProcessed).toBe(true);
    expect(replay.transaction.status).toBe('failed');
    // The debit is never re-attempted for a replayed key.
    expect(debitWallet).toHaveBeenCalledTimes(1);
  });
});

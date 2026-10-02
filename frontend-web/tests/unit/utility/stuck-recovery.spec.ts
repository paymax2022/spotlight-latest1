// AUD-BILL-005 — stuck-fulfilment recovery for utility payments.
//
// payUtility writes the utility_transactions row first, then debits the wallet,
// then calls the provider. A crash anywhere between debit and the final status
// update used to leave the row at 'initiated'/'wallet_debited' forever: money
// debited, no provider fulfilment, same-key replays returning alreadyProcessed,
// and requeryPendingUtilityTransactions requerying a provider that was never
// called (the VTPass request_id is timestamp-embedded and cannot be
// reconstructed) — which marked the row 'failed' WITHOUT reversing the debit.
//
// The fix: requeryUtilityTransaction drives crash recovery for pre-provider
// states from utility_provider_attempts evidence, auto-reverses the
// `utility:<tx>:DEBIT` leg (or refunds a captured Paystack charge via
// `utility:<tx>:PAYSTACK_REFUND`) when no attempt could possibly have vended,
// compensates provider_pending -> failed verdicts the same way, a CAS claim on
// (id, status, updated_at) keeps recovery away from in-flight writers and
// racing recoverers, and the ledger probe recognises BOTH writer conventions —
// TS verbatim keys AND the Go plane's per-side suffixes.
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
import { queueUtilityAdminAlert } from '@/src/server/utility/notifications';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { payUtility, requeryUtilityTransaction, reverseUtilityTransaction } from '@/src/server/utility/service';
import type { UtilityProviderAttemptRow, UtilityTransactionRow } from '@/src/server/utility/types';

const USER_ID = 'user-utility-stuck-001';
const PROVIDER_ID = 'provider-001';
const TX_ID = 'tx-stuck-001';

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

const STALE = new Date(Date.now() - 15 * 60_000).toISOString();
const FRESH = new Date().toISOString();

const BILLER = {
  id: 'biller-001',
  category: 'airtime',
  name: 'MTN',
  code: 'mtn',
  status: 'active',
  requires_validation: false,
  customer_reference_label: 'Phone number',
  dynamic_fields: [],
};

const PRODUCT = {
  id: 'product-001',
  biller_id: 'biller-001',
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

const MAPPING = {
  id: 'mapping-001',
  provider_id: PROVIDER_ID,
  product_id: 'product-001',
  provider_product_code: 'mtn',
  provider_biller_code: 'mtn',
  provider_cost_kobo: 490_000,
  provider_discount_bps: 0,
  status: 'active',
};

function txRow(overrides: Partial<UtilityTransactionRow> = {}): UtilityTransactionRow {
  return {
    id: TX_ID,
    user_id: USER_ID,
    category: 'airtime',
    biller_id: 'biller-001',
    product_id: 'product-001',
    provider_id: PROVIDER_ID,
    provider_mapping_id: 'mapping-001',
    customer_reference: '+2348011111111',
    customer_name: null,
    amount_kobo: 500_000,
    convenience_fee_kobo: 0,
    retail_amount_kobo: 500_000,
    provider_cost_kobo: 490_000,
    gross_profit_kobo: 10_000,
    gross_margin_bps: 200,
    status: 'wallet_debited',
    provider_reference: null,
    token: null,
    receipt_number: 'UTL-STUCK-001',
    idempotency_key: 'idem-stuck-1',
    payment_source: 'wallet',
    failure_reason: null,
    provider_response: null,
    metadata: {},
    created_at: STALE,
    updated_at: STALE,
    ...overrides,
  };
}

function attemptRow(overrides: Partial<UtilityProviderAttemptRow> = {}): UtilityProviderAttemptRow {
  return {
    id: `attempt-${Math.random()}`,
    transaction_id: TX_ID,
    provider_id: PROVIDER_ID,
    provider_mapping_id: 'mapping-001',
    attempt_number: 1,
    status: 'failed',
    request_idempotency_key: 'idem-stuck-1:provider:provider-001:attempt:1',
    provider_reference: null,
    message: null,
    raw_response: null,
    started_at: STALE,
    completed_at: STALE,
    duration_ms: 100,
    timeout_ms: null,
    ...overrides,
  };
}

/**
 * Fake admin client covering the recovery shapes: utility_transactions is
 * stateful by id with CAS-aware updates (eq/in filters must ALL match before
 * an update applies), utility_provider_attempts is a configurable list, and
 * ledger_entries is modelled as a set of posted idempotency keys plus
 * reference-keyed CREDIT lookups (the VALIDATION_REFUND probe).
 */
function makeFakeSupabase(opts: {
  transactions?: UtilityTransactionRow[];
  attempts?: UtilityProviderAttemptRow[];
  /** idempotency_key values already present in ledger_entries. */
  ledgerKeys?: string[];
  /** ledger_entries rows keyed on `reference` (VALIDATION_REFUND etc.). */
  ledgerRefs?: string[];
}) {
  const transactionsById = new Map<string, Record<string, unknown>>();
  for (const row of opts.transactions ?? []) transactionsById.set(row.id, { ...row });
  const attempts = opts.attempts ?? [];
  const ledgerKeys = new Set(opts.ledgerKeys ?? []);
  const ledgerRefs = new Set(opts.ledgerRefs ?? []);

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

    const resolve = async (): Promise<{ data: any; error: any }> => {
      switch (table) {
        case 'utility_transactions': {
          const rows = [...transactionsById.values()].filter((row) => matches(row, state.filters, state.ins, state.lts));
          return { data: rows.length <= 1 ? (rows[0] ?? null) : rows, error: null };
        }
        case 'utility_provider_attempts': {
          const filtered = attempts.filter((a) => matches(a as unknown as Record<string, unknown>, state.filters, state.ins, state.lts));
          return { data: filtered, error: null };
        }
        case 'utility_providers':
          return { data: state.filters.id === PROVIDER_ID ? PROVIDER : null, error: null };
        case 'utility_billers':
          return { data: state.filters.id === 'biller-001' ? BILLER : null, error: null };
        case 'utility_products':
          return { data: state.filters.id === 'product-001' ? PRODUCT : null, error: null };
        case 'utility_provider_product_mappings':
          return { data: [{ ...MAPPING, utility_providers: PROVIDER }], error: null };
        case 'utility_routing_rules':
          return { data: [], error: null };
        case 'utility_category_settings':
          return { data: null, error: null };
        case 'ledger_entries': {
          if (state.ins.idempotency_key) {
            return { data: (state.ins.idempotency_key as string[]).filter((k) => ledgerKeys.has(k)).map((k) => ({ idempotency_key: k })), error: null };
          }
          if (state.filters.reference !== undefined) {
            return { data: ledgerRefs.has(state.filters.reference as string) ? [{ id: 'leg-1' }] : [], error: null };
          }
          return { data: [], error: null };
        }
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
          const sel = { data: touched, error: null };
          return { then: (f: any) => Promise.resolve(sel).then(f) };
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

/** TS-plane debit + no compensation. */
function stubTsDebit() {
  return [`utility:${TX_ID}:DEBIT`];
}

describe('requeryUtilityTransaction — stuck initiated/wallet_debited recovery (AUD-BILL-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(getUtilityAdapter).mockReturnValue({
      queryTransactionStatus: vi.fn(async () => ({ status: 'failed', message: 'not found', raw: {} })),
    } as any);
  });

  it('auto-reverses a stale wallet_debited transaction with no provider attempts', async () => {
    const tx = txRow();
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${TX_ID}:REVERSAL_DEBIT`,
    }));
    expect(updated.status).toBe('reversed');
    expect(fake._transactionsById.get(TX_ID)?.status).toBe('reversed');
  });

  it('auto-reverses a Go-plane debit (key family <clientKey>:debit:*)', async () => {
    const tx = txRow({ idempotency_key: 'go-client-key-1' });
    const fake = makeFakeSupabase({
      transactions: [tx],
      attempts: [],
      ledgerKeys: ['go-client-key-1:debit:credit'],
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      idempotencyKey: `utility:${TX_ID}:REVERSAL_DEBIT`,
    }));
    expect(updated.status).toBe('reversed');
  });

  it('marks a stale initiated transaction failed without touching the wallet when the debit never posted', async () => {
    const tx = txRow({ status: 'initiated' });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    expect(updated.status).toBe('failed');
  });

  it('alerts when wallet_debited carries no debit leg — status claims money moved but none did', async () => {
    const tx = txRow();
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(queueUtilityAdminAlert).toHaveBeenCalled();
    expect(updated.status).toBe('failed');
  });

  it('auto-reverses when every attempt ended in a definitive provider failure', async () => {
    const tx = txRow();
    const fake = makeFakeSupabase({
      transactions: [tx],
      attempts: [attemptRow({ status: 'failed' }), attemptRow({ status: 'failed', attempt_number: 2 })],
      ledgerKeys: stubTsDebit(),
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).toHaveBeenCalledTimes(1);
    expect(updated.status).toBe('reversed');
  });

  it.each(['started', 'timeout', 'pending', 'error'] as const)(
    'never auto-reverses on a %s attempt — the provider may have vended; flags for manual reconciliation',
    async (attemptStatus) => {
      const tx = txRow();
      const fake = makeFakeSupabase({
        transactions: [tx],
        attempts: [attemptRow({ status: attemptStatus })],
        ledgerKeys: stubTsDebit(),
      });
      vi.mocked(createAdminClient).mockReturnValue(fake as any);

      const updated = await requeryUtilityTransaction(tx);

      expect(reverseWalletDebit).not.toHaveBeenCalled();
      expect(creditWallet).not.toHaveBeenCalled();
      expect(queueUtilityAdminAlert).toHaveBeenCalled();
      expect(updated.status).toBe('failed');
    },
  );

  it('leaves a fresh transaction untouched — an in-flight writer may still own it', async () => {
    const tx = txRow({ updated_at: FRESH, created_at: FRESH });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(updated.status).toBe('wallet_debited');
  });

  it('converges to reversed without a second money leg when compensation already posted', async () => {
    const tx = txRow();
    const fake = makeFakeSupabase({
      transactions: [tx],
      attempts: [],
      ledgerKeys: [...stubTsDebit(), `utility:${TX_ID}:REVERSAL_DEBIT`],
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(updated.status).toBe('reversed');
  });

  it('refunds a captured Paystack charge to the wallet instead of reversing a debit that never happened', async () => {
    const tx = txRow({ payment_source: 'paystack', metadata: { payment_reference: 'UTIL_REF_1' } });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `utility:${TX_ID}:PAYSTACK_REFUND`,
    }));
    expect(updated.status).toBe('reversed');
  });

  it('does not double-refund a Paystack charge already returned by the VALIDATION_REFUND path', async () => {
    const tx = txRow({ payment_source: 'paystack', metadata: { payment_reference: 'UTIL_REF_2' } });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [], ledgerRefs: ['UTIL_REF_2'] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await requeryUtilityTransaction(tx);

    expect(creditWallet).not.toHaveBeenCalled();
    expect(updated.status).toBe('reversed');
  });
});

describe('requeryUtilityTransaction — provider_pending verdict compensation', () => {
  const queryTransactionStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryTransactionStatus.mockReset();
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(getUtilityAdapter).mockReturnValue({ queryTransactionStatus } as any);
  });

  it('auto-reverses when the provider authoritatively reports a pending vend as failed', async () => {
    const tx = txRow({ status: 'provider_pending', provider_reference: 'req-abc-123' });
    const fake = makeFakeSupabase({
      transactions: [tx],
      attempts: [attemptRow({ status: 'pending', provider_reference: 'req-abc-123' })],
      ledgerKeys: stubTsDebit(),
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    queryTransactionStatus.mockResolvedValue({ status: 'failed', message: 'Provider failed transaction.', raw: {} });

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      idempotencyKey: `utility:${TX_ID}:REVERSAL_DEBIT`,
    }));
    expect(updated.status).toBe('reversed');
  });

  it('does not auto-reverse a failed verdict without a provider reference — the query used a fabricated request id', async () => {
    const tx = txRow({ status: 'provider_pending', provider_reference: null });
    const fake = makeFakeSupabase({
      transactions: [tx],
      attempts: [attemptRow({ status: 'timeout' })],
      ledgerKeys: stubTsDebit(),
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    queryTransactionStatus.mockResolvedValue({ status: 'failed', message: 'not found', raw: {} });

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(queueUtilityAdminAlert).toHaveBeenCalled();
    expect(updated.status).toBe('failed');
  });

  it('still marks a successful provider verdict successful (regression guard)', async () => {
    const tx = txRow({ status: 'provider_pending', provider_reference: 'req-abc-123' });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    queryTransactionStatus.mockResolvedValue({ status: 'successful', providerReference: 'req-abc-123', message: 'ok', raw: {} });

    const updated = await requeryUtilityTransaction(tx);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(updated.status).toBe('successful');
  });

  it('discards a successful verdict when a settlement claim owns the row — the CAS rejects it', async () => {
    // The caller's snapshot says provider_pending, but the stored row was
    // already claimed and compensated (status reversed, updated_at bumped) —
    // a stale 'successful' verdict must NOT resurrect it.
    const observed = txRow({ status: 'provider_pending', provider_reference: 'req-abc-123' });
    const claimed = txRow({ status: 'reversed', updated_at: new Date().toISOString() });
    const fake = makeFakeSupabase({ transactions: [claimed], attempts: [], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    queryTransactionStatus.mockResolvedValue({ status: 'successful', providerReference: 'req-abc-123', message: 'ok', raw: {} });

    const updated = await requeryUtilityTransaction(observed);

    expect(updated.status).toBe('reversed');
    expect(fake._transactionsById.get(TX_ID)?.status).toBe('reversed');
  });
});

describe('payUtility — replay of a stuck transaction recovers instead of masking it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(getUtilityAdapter).mockReturnValue({
      queryTransactionStatus: vi.fn(async () => ({ status: 'failed', message: 'not found', raw: {} })),
    } as any);
  });

  const replayInput = {
    category: 'airtime' as const,
    billerId: 'biller-001',
    productId: 'product-001',
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    paymentSource: 'wallet' as const,
    idempotencyKey: 'idem-stuck-1',
  };

  it('recovers a stale wallet_debited row on same-key replay and reports the reversal', async () => {
    const tx = txRow();
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const result = await payUtility(USER_ID, replayInput);

    expect(result.alreadyProcessed).toBe(true);
    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      idempotencyKey: `utility:${TX_ID}:REVERSAL_DEBIT`,
    }));
    expect(result.transaction.status).toBe('reversed');
  });

  it('returns a fresh in-flight row untouched', async () => {
    const tx = txRow({ status: 'initiated', updated_at: FRESH, created_at: FRESH });
    const fake = makeFakeSupabase({ transactions: [tx], attempts: [] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const result = await payUtility(USER_ID, replayInput);

    expect(result.alreadyProcessed).toBe(true);
    expect(result.transaction.status).toBe('initiated');
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });

  it('yields to a settlement claim that lands between the wallet debit and fulfilment', async () => {
    // A fresh insert owns (initiated, updated_at=T0). The debit mock flips the
    // stored row to 'failed' with a bumped updated_at — exactly what a recovery
    // claim does — so the wallet_debited CAS must refuse, the provider must
    // never be called, and this writer must NOT compensate (the claim winner
    // owns the money legs).
    const purchase = vi.fn(async () => ({ status: 'successful' as const, message: 'vend', raw: {} }));
    vi.mocked(getUtilityAdapter).mockReturnValue({ validateCustomer: vi.fn(async () => ({ valid: true })), purchase, queryTransactionStatus: vi.fn() } as any);
    const fake = makeFakeSupabase({ attempts: [] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    vi.mocked(debitWallet).mockImplementation(async () => {
      const [id, row] = [...fake._transactionsById.entries()][0]!;
      fake._transactionsById.set(id, { ...row, status: 'failed', updated_at: new Date().toISOString() });
      return { alreadyProcessed: false, amountKobo: 500_000 } as any;
    });

    const result = await payUtility(USER_ID, {
      category: 'airtime',
      billerId: 'biller-001',
      productId: 'product-001',
      customerReference: '+2348011111111',
      amountKobo: 500_000,
      paymentSource: 'wallet',
      idempotencyKey: 'idem-outraced-1',
    });

    expect(purchase).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(result.transaction.status).toBe('failed');
  });
});

describe('reverseUtilityTransaction — does not double-refund or mint unbacked refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 } as any);
  });

  it('skips the money leg when the automatic REVERSAL_DEBIT already posted', async () => {
    const tx = txRow({ status: 'failed' });
    const fake = makeFakeSupabase({
      transactions: [tx],
      ledgerKeys: [...stubTsDebit(), `utility:${TX_ID}:REVERSAL_DEBIT`],
    });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const updated = await reverseUtilityTransaction(tx, 'admin manual reversal');

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
    expect(updated.status).toBe('reversed');
  });

  it('refuses to mint a reversal on a wallet-source row with no debit leg at all', async () => {
    const tx = txRow({ status: 'failed' });
    const fake = makeFakeSupabase({ transactions: [tx] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await expect(reverseUtilityTransaction(tx, 'admin manual reversal')).rejects.toThrow(/nothing to reverse/i);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('still posts ADMIN_REVERSAL_DEBIT for a genuinely debited, uncompensated failure', async () => {
    const tx = txRow({ status: 'failed' });
    const fake = makeFakeSupabase({ transactions: [tx], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await reverseUtilityTransaction(tx, 'admin manual reversal');

    expect(reverseWalletDebit).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      idempotencyKey: `utility:${TX_ID}:ADMIN_REVERSAL_DEBIT`,
    }));
  });

  it('refuses a just-failed row still inside the settle window — a compensator may be mid-flight', async () => {
    // Fresh 'failed' rows are inside the probe→post window of whichever
    // compensator wrote them; the admin claim refuses rather than racing it.
    const tx = txRow({ status: 'failed', updated_at: FRESH });
    const fake = makeFakeSupabase({ transactions: [tx], ledgerKeys: stubTsDebit() });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await expect(reverseUtilityTransaction(tx, 'admin manual reversal')).rejects.toThrow(/being settled/i);

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('refuses to credit a paystack-source row with no captured payment_reference — nothing proves funds were taken', async () => {
    const tx = txRow({ status: 'failed', payment_source: 'paystack', metadata: {} });
    const fake = makeFakeSupabase({ transactions: [tx] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await expect(reverseUtilityTransaction(tx, 'admin manual reversal')).rejects.toThrow(/payment reference/i);

    expect(creditWallet).not.toHaveBeenCalled();
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});

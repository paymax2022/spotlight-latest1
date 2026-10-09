// Idempotency replay — param-checked adoption parity with the Go plane.
//
// backend/internal/utilitybills (service.go replayMatchesRequest +
// repository.go sameCallerReplay) treats a same-caller replay whose request
// diverges on any material param — category, biller, product, customer
// reference, payment rail, or amount — as idempotency-key MISUSE and answers
// 409 instead of adopting the stored row. The TS plane scoped replays to the
// caller (AUD-BILL-005) but never compared the params: same key + different
// purchase silently returned the original row — acking a ₦1,000 airtime vend
// for a request that asked for ₦5,000 of data. The paystack-intent lane had
// neither check: a foreign member's key replayed THEIR intent (with their
// authorization_url) back to this caller, and a 23505 race fell to a 500.
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

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/registration/return-origin', () => ({
  resolveReturnOrigin: vi.fn(() => null),
  isReturnableOrigin: vi.fn(() => false),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { debitWallet } from '@/src/server/wallet/service';
import { getUtilityAdapter } from '@/src/server/utility/adapters/registry';
import { resolveUtilityCommission } from '@/src/server/commission/config';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';
import { payUtility } from '@/src/server/utility/service';
import { initiateUtilityPaystackPayment } from '@/app/api/v1/utility/paystack/_service';

const USER_ID = 'user-replay-001';
const OTHER_USER_ID = 'user-replay-002';
const BILLER_ID = 'biller-001';
const PRODUCT_ID = 'product-001';
const MAPPING_ID = 'mapping-001';
const PROVIDER_ID = 'provider-001';

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

// Minimal supabase fake covering the two idempotency-guarded tables.
// `masked*` rows model the crash-window race: invisible to the pre-check
// select, then "revealed" by the insert attempt (which must answer 23505),
// so the unique-violation fallback re-select can see them.
function makeFakeSupabase(opts: {
  transactions?: Array<Record<string, unknown>>;
  maskedTransactions?: Array<Record<string, unknown>>;
  intents?: Array<Record<string, unknown>>;
  maskedIntents?: Array<Record<string, unknown>>;
} = {}) {
  const transactions = new Map<string, Record<string, unknown>>();
  const maskedTransactions = new Map<string, Record<string, unknown>>();
  const intents = new Map<string, Record<string, unknown>>();
  const maskedIntents = new Map<string, Record<string, unknown>>();
  let txMaskRevealed = false;
  let intentMaskRevealed = false;
  const events: Array<Record<string, unknown>> = [];

  for (const row of opts.transactions ?? []) transactions.set(String(row.id), { ...row });
  for (const row of opts.maskedTransactions ?? []) maskedTransactions.set(String(row.id), { ...row });
  for (const row of opts.intents ?? []) intents.set(String(row.id), { ...row });
  for (const row of opts.maskedIntents ?? []) maskedIntents.set(String(row.id), { ...row });

  function visibleRows(table: string) {
    if (table === 'utility_transactions') {
      return txMaskRevealed
        ? [...transactions.values(), ...maskedTransactions.values()]
        : [...transactions.values()];
    }
    if (table === 'utility_paystack_intents') {
      return intentMaskRevealed
        ? [...intents.values(), ...maskedIntents.values()]
        : [...intents.values()];
    }
    return [];
  }

  function keyTaken(table: string, key: unknown) {
    for (const row of visibleRows(table)) {
      if (row.idempotency_key === key) return true;
    }
    // A masked row claims its key even before the reveal — that is the race.
    const hidden = table === 'utility_transactions' ? maskedTransactions : maskedIntents;
    for (const row of hidden.values()) {
      if (row.idempotency_key === key) return true;
    }
    return false;
  }

  function builderFor(table: string) {
    const state: {
      filters: Record<string, unknown>;
      ins: Record<string, unknown[]>;
      insertPayload?: any;
      insertError?: { code: string; message: string };
      updatePayload?: any;
    } = { filters: {}, ins: {} };

    const resolve = async () => {
      switch (table) {
        case 'utility_transactions': {
          const rows = visibleRows(table).filter((row) => {
            for (const [col, val] of Object.entries(state.filters)) {
              if (row[col] !== val) return false;
            }
            for (const [col, vals] of Object.entries(state.ins)) {
              if (!vals.includes(row[col])) return false;
            }
            return true;
          });
          if (state.filters.idempotency_key !== undefined) {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        }
        case 'utility_paystack_intents': {
          const rows = visibleRows(table).filter((row) => {
            for (const [col, val] of Object.entries(state.filters)) {
              if (row[col] !== val) return false;
            }
            return true;
          });
          return { data: rows[0] ?? null, error: null };
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
        default:
          return { data: null, error: null };
      }
    };

    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        state.filters[col] = val;
        return builder;
      }),
      neq: vi.fn(() => builder),
      in: vi.fn((col: string, vals: unknown[]) => {
        state.ins[col] = vals;
        return builder;
      }),
      lt: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((payload: any) => {
        state.insertPayload = payload;
        if (table === 'utility_transactions') {
          txMaskRevealed = true;
          if (keyTaken(table, payload.idempotency_key)) {
            state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
          } else {
            transactions.set(payload.id, { ...payload });
          }
        }
        if (table === 'utility_paystack_intents') {
          intentMaskRevealed = true;
          if (keyTaken(table, payload.idempotency_key)) {
            state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
          } else {
            intents.set(payload.id, { ...payload });
          }
        }
        if (table === 'utility_transaction_events') {
          events.push({ ...payload });
        }
        return builder;
      }),
      update: vi.fn(() => builder),
      maybeSingle: vi.fn(() => resolve()),
      single: vi.fn(async () => {
        if (state.insertError) return { data: null, error: state.insertError };
        if (state.insertPayload) return { data: state.insertPayload, error: null };
        return resolve();
      }),
      then: (onFulfilled: any) => {
        if (state.insertError) return Promise.resolve({ data: null, error: state.insertError }).then(onFulfilled);
        if (state.insertPayload) {
          // bare `await ...insert(...)` (no .select()) resolves { error: null }
          if (table === 'utility_paystack_intents' || table === 'utility_transaction_events') {
            return Promise.resolve({ data: state.insertPayload, error: null }).then(onFulfilled);
          }
        }
        return resolve().then(onFulfilled);
      },
    };

    return builder;
  }

  return {
    from: vi.fn((table: string) => builderFor(table)),
    _transactions: transactions,
    _intents: intents,
    _events: events,
  };
}

function seededTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-seeded-001',
    user_id: USER_ID,
    category: 'airtime',
    biller_id: BILLER_ID,
    product_id: PRODUCT_ID,
    customer_reference: '+2348011111111',
    amount_kobo: 500_000,
    retail_amount_kobo: 500_000,
    status: 'successful',
    receipt_number: 'UTL-20260901-AAAA1111',
    idempotency_key: 'idem-replay-key',
    payment_source: 'wallet',
    updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides,
  };
}

function payInput(key: string, overrides: Record<string, unknown> = {}) {
  return {
    category: 'airtime' as const,
    billerId: BILLER_ID,
    productId: PRODUCT_ID,
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    paymentSource: 'wallet' as const,
    idempotencyKey: key,
    metadata: {},
    ...overrides,
  };
}

describe('payUtility — param-checked same-caller replay (Go parity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveUtilityCommission).mockResolvedValue({ service: null, subtype: '', config: null });
    vi.mocked(getUtilityAdapter).mockReturnValue({
      validateCustomer: vi.fn(async () => ({ valid: true })),
      purchase: vi.fn(),
      queryTransactionStatus: vi.fn(),
    } as any);
  });

  it('identical request under the used key replays the stored row', async () => {
    const seeded = seededTransaction();
    vi.mocked(createAdminClient).mockReturnValue(makeFakeSupabase({ transactions: [seeded] }) as any);

    const res = await payUtility(USER_ID, payInput('idem-replay-key'));
    expect(res.alreadyProcessed).toBe(true);
    expect(res.transaction.id).toBe(seeded.id);
    // A clean replay never re-debits.
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amountKobo: 5_000_000 }],
    ['biller', { billerId: 'biller-999' }],
    ['product', { productId: 'product-999' }],
    ['customer reference', { customerReference: '+2348099999999' }],
    ['payment rail', { paymentSource: 'paystack' }],
    ['category', { category: 'data' }],
  ])('divergent %s under the used key is a 409, never a replay', async (_name, override) => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ transactions: [seededTransaction()] }) as any,
    );

    await expect(payUtility(USER_ID, payInput('idem-replay-key', override))).rejects.toMatchObject({
      status: 409,
    });
    expect(debitWallet).not.toHaveBeenCalled();
  });

  it('a key another member used is a 409, not their transaction', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ transactions: [seededTransaction({ user_id: OTHER_USER_ID })] }) as any,
    );

    await expect(payUtility(USER_ID, payInput('idem-replay-key'))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('23505 race: identical request appearing mid-flight still replays', async () => {
    const seeded = seededTransaction();
    const fake = makeFakeSupabase({ maskedTransactions: [seeded] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    const res = await payUtility(USER_ID, payInput('idem-replay-key'));
    expect(res.alreadyProcessed).toBe(true);
    expect(res.transaction.id).toBe(seeded.id);
  });

  it('23505 race: divergent request appearing mid-flight is a 409', async () => {
    const fake = makeFakeSupabase({ maskedTransactions: [seededTransaction()] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await expect(
      payUtility(USER_ID, payInput('idem-replay-key', { customerReference: '+2348099999999' })),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('23505 race: a foreign-caller row appearing mid-flight is a 409', async () => {
    const fake = makeFakeSupabase({ maskedTransactions: [seededTransaction({ user_id: OTHER_USER_ID })] });
    vi.mocked(createAdminClient).mockReturnValue(fake as any);

    await expect(payUtility(USER_ID, payInput('idem-replay-key'))).rejects.toMatchObject({
      status: 409,
    });
  });
});

function seededIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-seeded-001',
    user_id: USER_ID,
    category: 'airtime',
    biller_id: BILLER_ID,
    product_id: PRODUCT_ID,
    customer_reference: '+2348011111111',
    amount_kobo: 500_000,
    retail_amount_kobo: 500_000,
    payment_reference: 'UTIL_SEEDED001',
    authorization_url: 'https://checkout.paystack.com/seeded',
    idempotency_key: 'idem-intent-key',
    status: 'pending',
    ...overrides,
  };
}

function initiateInput(key: string, overrides: Record<string, unknown> = {}) {
  return {
    request: new Request('https://app.test/api/v1/utility/paystack/initiate', { method: 'POST' }),
    userId: USER_ID,
    email: 'member@test.local',
    category: 'airtime' as const,
    billerId: BILLER_ID,
    productId: PRODUCT_ID,
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    metadata: {},
    idempotencyKey: key,
    ...overrides,
  };
}

describe('initiateUtilityPaystackPayment — caller-scoped, param-checked replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a foreign member’s intent key is a 409, not their checkout URL', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ intents: [seededIntent({ user_id: OTHER_USER_ID })] }) as any,
    );

    await expect(initiateUtilityPaystackPayment(initiateInput('idem-intent-key'))).rejects.toMatchObject({
      status: 409,
    });
  });

  it.each([
    ['amount', { amountKobo: 5_000_000 }],
    ['biller', { billerId: 'biller-999' }],
    ['product', { productId: 'product-999' }],
    ['customer reference', { customerReference: '+2348099999999' }],
    ['category', { category: 'data' }],
  ])('same-caller divergent %s under the used key is a 409', async (_name, override) => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ intents: [seededIntent()] }) as any,
    );

    await expect(initiateUtilityPaystackPayment(initiateInput('idem-intent-key', override))).rejects.toMatchObject({
      status: 409,
    });
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('identical request under the used key replays the stored intent', async () => {
    const seeded = seededIntent();
    vi.mocked(createAdminClient).mockReturnValue(makeFakeSupabase({ intents: [seeded] }) as any);

    const res = await initiateUtilityPaystackPayment(initiateInput('idem-intent-key'));
    expect(res.alreadyProcessed).toBe(true);
    expect(res.paymentReference).toBe('UTIL_SEEDED001');
    expect(res.authorizationUrl).toBe('https://checkout.paystack.com/seeded');
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('23505 race: identical intent appearing mid-flight replays it', async () => {
    const seeded = seededIntent();
    vi.mocked(createAdminClient).mockReturnValue(makeFakeSupabase({ maskedIntents: [seeded] }) as any);

    const res = await initiateUtilityPaystackPayment(initiateInput('idem-intent-key'));
    expect(res.alreadyProcessed).toBe(true);
    expect(res.paymentReference).toBe('UTIL_SEEDED001');
  });

  it('23505 race: a foreign intent appearing mid-flight is a 409, not a 500', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeFakeSupabase({ maskedIntents: [seededIntent({ user_id: OTHER_USER_ID })] }) as any,
    );

    await expect(initiateUtilityPaystackPayment(initiateInput('idem-intent-key'))).rejects.toMatchObject({
      status: 409,
    });
  });
});

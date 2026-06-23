/**
 * Wallet service tests — Supabase mocked, no DB, no HTTP.
 *
 * Covers: getBalance, creditWallet (happy + idempotency + insufficient funds on debit),
 * debitWallet, listTransactions, createTopupIntent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

// Stub the tier-limits service so debitWallet tests don't need KYC DB calls.
vi.mock('@/src/server/tiers/service', () => ({
  enforceWalletLimit: vi.fn().mockResolvedValue({ dailyLimitKobo: null }),
}));

import {
  getBalance,
  creditWallet,
  debitWallet,
  reverseWalletDebit,
  listTransactions,
  createTopupIntent,
} from '@/src/server/wallet/service';
import { createAdminClient } from '@/lib/supabase/server';

const USER_ID = 'user-wallet-001';
const ACCOUNT_ID = 'account-uuid-001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function existingAccount() {
  return { id: ACCOUNT_ID };
}

function balanceRow(available_kobo: number) {
  return { available_kobo, currency: 'NGN', account_id: ACCOUNT_ID };
}

/**
 * Configure mock for calls that go: maybySingle (account lookup) + ... more queries.
 * Each maybySingle call is queued FIFO.
 */
function setupMock() {
  const { mock, maybySingle, single, insertFn, updateFn, updateEq, listData } = makeSupabaseMock();
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return { mock, maybySingle, single, insertFn, updateFn, updateEq, listData };
}

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe('getBalance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns available_kobo=0 for a new account with no entries', async () => {
    const { maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: existingAccount(), error: null }) // account lookup
      .mockResolvedValueOnce({ data: null, error: null })              // mobile_fintech (migrate)
      .mockResolvedValueOnce({ data: null, error: null })              // wallet_balance (no row)
      .mockResolvedValueOnce({ data: null, error: null });             // mobile_fintech (balance=0 path)

    const result = await getBalance(USER_ID);
    expect(result.available_kobo).toBe(0);
    expect(result.currency).toBe('NGN');
  });

  it('returns the correct balance from the wallet_balance view', async () => {
    const { maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: existingAccount(), error: null }) // account lookup
      .mockResolvedValueOnce({ data: null, error: null })              // mobile_fintech (migrate)
      .mockResolvedValueOnce({ data: balanceRow(250_000), error: null }); // wallet_balance

    const result = await getBalance(USER_ID);
    expect(result.available_kobo).toBe(250_000);
  });

  it('creates a new account when one does not exist', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })             // no existing account
      .mockResolvedValueOnce({ data: null, error: null })             // mobile_fintech (migrate)
      .mockResolvedValueOnce({ data: null, error: null })             // wallet_balance (new acct)
      .mockResolvedValueOnce({ data: null, error: null });            // mobile_fintech (balance=0)
    insertFn.mockResolvedValueOnce({ error: null });

    const result = await getBalance(USER_ID);
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(result.available_kobo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// creditWallet
// ---------------------------------------------------------------------------

describe('creditWallet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a CREDIT entry and returns alreadyProcessed=false', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })            // idempotency check: miss
      .mockResolvedValueOnce({ data: existingAccount(), error: null }); // account lookup
    insertFn.mockResolvedValueOnce({ error: null });

    const result = await creditWallet(USER_ID, {
      amountKobo: 100_000,
      reference: 'PAY_ref_001',
      idempotencyKey: 'topup:intent-001:CREDIT',
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.amountKobo).toBe(100_000);
    expect(insertFn).toHaveBeenCalledOnce();
  });

  it('returns alreadyProcessed=true when idempotency key already exists', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle.mockResolvedValueOnce({
      data: { amount_kobo: 100_000, type: 'CREDIT' },
      error: null,
    }); // idempotency hit

    const result = await creditWallet(USER_ID, {
      amountKobo: 100_000,
      reference: 'PAY_ref_001',
      idempotencyKey: 'topup:intent-001:CREDIT',
    });

    expect(result.alreadyProcessed).toBe(true);
    expect(result.amountKobo).toBe(100_000);
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('throws when amount_kobo is not a positive integer', async () => {
    await expect(
      creditWallet(USER_ID, { amountKobo: 0, reference: 'x', idempotencyKey: 'key-1' }),
    ).rejects.toThrow(/positive/i);

    await expect(
      creditWallet(USER_ID, { amountKobo: 99.99, reference: 'x', idempotencyKey: 'key-2' }),
    ).rejects.toThrow(/integer/i);
  });
});

// ---------------------------------------------------------------------------
// debitWallet
// ---------------------------------------------------------------------------

describe('debitWallet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls debit_wallet_atomic RPC when balance is sufficient', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })              // idempotency miss
      .mockResolvedValueOnce({ data: existingAccount(), error: null }) // account
      .mockResolvedValueOnce({ data: null, error: null });             // mobile_fintech (migrate)
    // rpc returns no error → success
    vi.mocked(mock.rpc).mockResolvedValueOnce({ data: null, error: null });

    const result = await debitWallet(USER_ID, {
      amountKobo: 200_000,
      reference: 'VOTE_ref_001',
      idempotencyKey: 'vote:ref-001:DEBIT',
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.amountKobo).toBe(200_000);
    expect(mock.rpc).toHaveBeenCalledWith('debit_wallet_atomic', expect.objectContaining({
      p_account_id: ACCOUNT_ID,
      p_amount_kobo: 200_000,
    }));
  });

  it('throws 402 when RPC reports INSUFFICIENT_BALANCE', async () => {
    const { mock, maybySingle } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })              // idempotency miss
      .mockResolvedValueOnce({ data: existingAccount(), error: null }) // account
      .mockResolvedValueOnce({ data: null, error: null });             // mobile_fintech (migrate)
    vi.mocked(mock.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'INSUFFICIENT_BALANCE: available=10000 required=200000', code: 'P0001' },
    });

    const { ApiError } = await import('@/src/lib/api/responses');

    const err = await debitWallet(USER_ID, {
      amountKobo: 200_000,
      reference: 'VOTE_ref_001',
      idempotencyKey: 'vote:ref-001:DEBIT',
    }).catch(e => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(402);
  });

  it('returns alreadyProcessed=true when idempotency key already exists', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle.mockResolvedValueOnce({
      data: { amount_kobo: 200_000, type: 'DEBIT' },
      error: null,
    }); // idempotency hit

    const result = await debitWallet(USER_ID, {
      amountKobo: 200_000,
      reference: 'VOTE_ref_001',
      idempotencyKey: 'vote:ref-001:DEBIT',
    });

    expect(result.alreadyProcessed).toBe(true);
    expect(insertFn).not.toHaveBeenCalled();
  });
});

describe('reverseWalletDebit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a REVERSAL_DEBIT entry for an idempotent refund', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: existingAccount(), error: null });
    insertFn.mockResolvedValueOnce({ error: null });

    const result = await reverseWalletDebit(USER_ID, {
      amountKobo: 200_000,
      reference: 'UTL-REFUND-001',
      idempotencyKey: 'utility:tx-001:REVERSAL_DEBIT',
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REVERSAL_DEBIT',
      amount_kobo: 200_000,
      reference: 'UTL-REFUND-001',
      idempotency_key: 'utility:tx-001:REVERSAL_DEBIT',
    }));
  });
});

// ---------------------------------------------------------------------------
// listTransactions
// ---------------------------------------------------------------------------

describe('listTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns entries in reverse chronological order', async () => {
    const entries = [
      { id: 'e2', type: 'DEBIT', amount_kobo: 50_000, created_at: '2026-06-13T12:00:00Z' },
      { id: 'e1', type: 'CREDIT', amount_kobo: 100_000, created_at: '2026-06-13T10:00:00Z' },
    ];
    const { maybySingle, listData } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: existingAccount(), error: null });
    listData.mockResolvedValueOnce({ data: entries, error: null });

    const result = await listTransactions(USER_ID);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('e2');
    expect(result[1].id).toBe('e1');
  });

  it('returns empty array when no transactions exist', async () => {
    const { maybySingle, listData } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: existingAccount(), error: null });
    listData.mockResolvedValueOnce({ data: [], error: null });

    const result = await listTransactions(USER_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createTopupIntent
// ---------------------------------------------------------------------------

describe('createTopupIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc123';
  });

  it('creates an intent and calls Paystack initialize', async () => {
    const { maybySingle, insertFn, updateFn, updateEq } = setupMock();
    // Idempotency check: miss
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    insertFn.mockResolvedValueOnce({ error: null });
    updateEq.mockResolvedValueOnce({ error: null });

    // Mock fetch (Paystack API)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/xyz' },
      }),
    } as Response);

    const result = await createTopupIntent(USER_ID, 'user@example.com', {
      amountKobo: 50_000,
      idempotencyKey: 'topup-req-001',
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
    expect(result.amountKobo).toBe(50_000);
    expect(result.paymentReference).toMatch(/^TOPUP_/);
  });

  it('returns alreadyProcessed=true when idempotency key exists', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({
      data: {
        id: 'intent-existing',
        payment_reference: 'TOPUP_EXISTING',
        authorization_url: 'https://checkout.paystack.com/existing',
        amount_kobo: 50_000,
      },
      error: null,
    });

    const result = await createTopupIntent(USER_ID, 'user@example.com', {
      amountKobo: 50_000,
      idempotencyKey: 'topup-req-001',
    });

    expect(result.alreadyProcessed).toBe(true);
    expect(result.intentId).toBe('intent-existing');
  });

  it('throws 400 when amount_kobo is below minimum (₦100 = 10000 kobo)', async () => {
    const { ApiError } = await import('@/src/lib/api/responses');

    await expect(
      createTopupIntent(USER_ID, 'user@example.com', {
        amountKobo: 500, // ₦5 — below ₦100 minimum
        idempotencyKey: 'topup-req-too-small',
      }),
    ).rejects.toThrow(ApiError);
  });

  it('throws when Paystack API returns non-OK response', async () => {
    const { maybySingle, insertFn } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // idempotency miss
    insertFn.mockResolvedValueOnce({ error: null });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(
      createTopupIntent(USER_ID, 'user@example.com', {
        amountKobo: 50_000,
        idempotencyKey: 'topup-req-paystack-fail',
      }),
    ).rejects.toThrow(/Paystack initialization failed/i);
  });
});

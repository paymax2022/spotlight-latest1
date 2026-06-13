/**
 * Virtual account service tests — Supabase mocked, Paystack fetch mocked, no DB.
 *
 * Covers: provisionVirtualAccount (happy + idempotent + Paystack failure + race),
 *         getVirtualAccount, getVirtualAccountByNumber, handleDvaTransferWebhook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

// Also mock creditWallet for the webhook handler tests
vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(),
}));

import {
  provisionVirtualAccount,
  getVirtualAccount,
} from '@/src/server/virtual-accounts/service';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';
import { creditWallet } from '@/src/server/wallet/service';
import { createAdminClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-dva-001';
const DVA_ROW = {
  id: 'dva-row-001',
  user_id: USER_ID,
  provider: 'paystack',
  customer_code: 'CUS_abc123',
  account_number: '1234567890',
  account_name: 'SPOTLIGHT / USER DVA 001',
  bank_name: 'Wema Bank',
  bank_code: '945',
  currency: 'NGN',
  provisioned_at: '2026-06-13T12:00:00Z',
};

function mockPaystackCustomer() {
  return {
    ok: true,
    json: async () => ({
      status: true,
      data: { customer_code: 'CUS_abc123' },
    }),
  } as Response;
}

function mockPaystackDva() {
  return {
    ok: true,
    json: async () => ({
      status: true,
      data: {
        account_number: '1234567890',
        account_name: 'SPOTLIGHT / USER DVA 001',
        bank: { name: 'Wema Bank', id: 945, slug: 'wema-bank' },
      },
    }),
  } as Response;
}

function setupMock() {
  const tools = makeSupabaseMock();
  vi.mocked(createAdminClient).mockReturnValue(tools.mock as any);
  return tools;
}

// ---------------------------------------------------------------------------
// getVirtualAccount
// ---------------------------------------------------------------------------

describe('getVirtualAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no virtual account exists', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await getVirtualAccount(USER_ID);
    expect(result).toBeNull();
  });

  it('returns the account row when it exists', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: DVA_ROW, error: null });

    const result = await getVirtualAccount(USER_ID);
    expect(result?.account_number).toBe('1234567890');
    expect(result?.bank_name).toBe('Wema Bank');
  });
});

// ---------------------------------------------------------------------------
// provisionVirtualAccount
// ---------------------------------------------------------------------------

describe('provisionVirtualAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc';
    process.env.PAYSTACK_DVA_BANK = 'wema-bank';
  });

  it('returns existing account without calling Paystack when already provisioned', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: DVA_ROW, error: null }); // getVirtualAccount

    global.fetch = vi.fn();

    const result = await provisionVirtualAccount(USER_ID, 'u@example.com', 'John', 'Doe');

    expect(result.account_number).toBe('1234567890');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls Paystack and saves the DVA on first provision', async () => {
    const { maybySingle, insertFn } = setupMock();

    // getVirtualAccount → null (not yet provisioned)
    maybySingle.mockResolvedValueOnce({ data: null, error: null });
    insertFn.mockResolvedValueOnce({ error: null });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockPaystackCustomer())  // POST /customer
      .mockResolvedValueOnce(mockPaystackDva());      // POST /dedicated_account

    const result = await provisionVirtualAccount(USER_ID, 'u@example.com', 'John', 'Doe');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.account_number).toBe('1234567890');
    expect(result.bank_name).toBe('Wema Bank');
    expect(result.customer_code).toBe('CUS_abc123');
  });

  it('throws ApiError when Paystack customer creation fails', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      text: async () => 'Invalid email',
    } as Response);

    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(
      provisionVirtualAccount(USER_ID, 'bad', 'John', 'Doe'),
    ).rejects.toThrow(ApiError);
  });

  it('throws when Paystack DVA creation fails', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockPaystackCustomer())
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Unprocessable Entity',
        text: async () => 'Customer already has a DVA on this bank',
      } as Response);

    const { ApiError } = await import('@/src/lib/api/responses');
    await expect(
      provisionVirtualAccount(USER_ID, 'u@example.com', 'John', 'Doe'),
    ).rejects.toThrow(ApiError);
  });

  it('handles concurrent provisioning race (23505 error) by re-fetching', async () => {
    // First getVirtualAccount → null, then INSERT → 23505, then re-fetch → existing row
    const { maybySingle, insertFn } = setupMock();

    maybySingle
      .mockResolvedValueOnce({ data: null, error: null })      // first getVirtualAccount: not found
      .mockResolvedValueOnce({ data: DVA_ROW, error: null });  // re-fetch after 23505

    insertFn.mockResolvedValueOnce({ error: { code: '23505', message: 'unique violation' } });

    global.fetch = vi.fn()
      .mockResolvedValueOnce(mockPaystackCustomer())
      .mockResolvedValueOnce(mockPaystackDva());

    const result = await provisionVirtualAccount(USER_ID, 'u@example.com', 'John', 'Doe');
    expect(result.account_number).toBe('1234567890');
  });
});

// ---------------------------------------------------------------------------
// handleDvaTransferWebhook
// ---------------------------------------------------------------------------

describe('handleDvaTransferWebhook', () => {
  const PAYSTACK_SECRET = 'sk_test_webhook_secret';
  const ACCOUNT_NUMBER = '1234567890';
  const REFERENCE = 'DVA_TRANSFER_REF_001';

  function makeSignature(body: string) {
    const crypto = require('node:crypto') as typeof import('node:crypto');
    return crypto.createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
  }

  function makeDvaEvent(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      event: 'charge.success',
      data: {
        reference: REFERENCE,
        amount: 500_000,
        channel: 'dedicated_nuban',
        currency: 'NGN',
        authorization: { account_number: ACCOUNT_NUMBER },
        ...overrides,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
  });

  it('credits wallet and returns processed=true for a valid DVA transfer', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: DVA_ROW, error: null }); // getVirtualAccountByNumber

    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: false, amountKobo: 500_000 });

    const body = makeDvaEvent();
    const result = await handleDvaTransferWebhook(body, makeSignature(body));

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
      idempotencyKey: `dva:${REFERENCE}:CREDIT`,
    }));
  });

  it('returns duplicate=true when ledger entry already exists', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: DVA_ROW, error: null });

    vi.mocked(creditWallet).mockResolvedValue({ alreadyProcessed: true, amountKobo: 500_000 });

    const body = makeDvaEvent();
    const result = await handleDvaTransferWebhook(body, makeSignature(body));

    expect(result.processed).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  it('returns processed=false when signature is invalid', async () => {
    const body = makeDvaEvent();
    const result = await handleDvaTransferWebhook(body, 'bad-signature');

    expect(result.processed).toBe(false);
    expect(result.error).toMatch(/invalid signature/i);
  });

  it('returns processed=false for non-DVA charge.success events', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'PAY_001', amount: 50_000, channel: 'card' },
    });
    const result = await handleDvaTransferWebhook(body, makeSignature(body));

    expect(result.processed).toBe(false);
    expect(result.duplicate).toBe(false);
  });

  it('returns processed=false when no virtual account matches the account_number', async () => {
    const { maybySingle } = setupMock();
    maybySingle.mockResolvedValueOnce({ data: null, error: null }); // no matching virtual account

    const body = makeDvaEvent();
    const result = await handleDvaTransferWebhook(body, makeSignature(body));

    expect(result.processed).toBe(false);
    expect(creditWallet).not.toHaveBeenCalled();
  });

  it('returns processed=false for non charge.success events', async () => {
    const body = JSON.stringify({ event: 'transfer.success', data: {} });
    const result = await handleDvaTransferWebhook(body, makeSignature(body));

    expect(result.processed).toBe(false);
  });
});

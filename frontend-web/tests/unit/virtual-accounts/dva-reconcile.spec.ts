/**
 * AUD-FE-004 residual — DVA inbound self-heal.
 *
 * Inbound transfers to a Dedicated Virtual Account were webhook-only: a dropped
 * or failed charge.success meant the sender's money was collected by Paystack
 * but never credited to the wallet, with no path to recovery. Mirroring the
 * wallet top-up "verify-on-read" pattern, reading the virtual account now
 * reconciles the customer's recent successful DVA transactions at Paystack
 * against the ledger — crediting any the webhook missed through the SAME
 * `dva:<reference>:CREDIT` idempotency key, so the two paths can never
 * double-credit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(async () => ({ alreadyProcessed: false, amountKobo: 0 })),
}));

import { creditWallet } from '@/src/server/wallet/service';
import {
  reconcileDvaInboundTransfers,
  creditDvaInboundTransfer,
} from '@/src/server/virtual-accounts/reconcile';
import type { VirtualAccountRow } from '@/src/server/virtual-accounts/service';

const mockCredit = creditWallet as ReturnType<typeof vi.fn>;

const ACCOUNT: VirtualAccountRow = {
  id: 'va-1',
  user_id: 'user-1',
  provider: 'paystack',
  customer_code: 'CUS_abc',
  account_number: '9912345678',
  account_name: 'PAYMAX / USER',
  bank_name: 'Wema Bank',
  bank_code: '035',
  currency: 'NGN',
  provisioned_at: '2026-01-01T00:00:00Z',
};

function paystackTxns(data: unknown[], ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ status: ok, data }),
  })));
}

const dvaTxn = (reference: string, amount = 50_000) => ({
  reference,
  amount,
  status: 'success',
  channel: 'dedicated_nuban',
  currency: 'NGN',
  authorization: { account_number: '9912345678', channel: 'dedicated_nuban' },
});

beforeEach(() => {
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_stubbed');
  mockCredit.mockReset().mockResolvedValue({ alreadyProcessed: false, amountKobo: 0 });
});

describe('reconcileDvaInboundTransfers', () => {
  it('credits a successful inbound DVA transaction the webhook missed', async () => {
    paystackTxns([dvaTxn('PSK_ref_1', 75_000)]);

    const result = await reconcileDvaInboundTransfers(ACCOUNT);

    expect(result).toMatchObject({ checked: 1, credited: 1 });
    expect(mockCredit).toHaveBeenCalledWith('user-1', expect.objectContaining({
      amountKobo: 75_000,
      idempotencyKey: 'dva:PSK_ref_1:CREDIT',
      reference: 'DVA:PSK_ref_1',
    }));
  });

  it('does not double-credit a transaction the ledger already holds', async () => {
    mockCredit.mockResolvedValue({ alreadyProcessed: true, amountKobo: 50_000 });
    paystackTxns([dvaTxn('PSK_ref_seen')]);

    const result = await reconcileDvaInboundTransfers(ACCOUNT);

    expect(result.credited).toBe(0);
    expect(mockCredit).toHaveBeenCalledTimes(1); // ledger key is the arbiter
  });

  it('ignores transactions that are not inbound to THIS account', async () => {
    paystackTxns([
      { ...dvaTxn('card_charge'), channel: 'card' },
      { ...dvaTxn('other_dva'), authorization: { account_number: '0000000001' } },
      { ...dvaTxn('still_pending'), status: 'pending' },
      { ...dvaTxn('bad_amount'), amount: 10.5 },
      { reference: '', amount: 5000, status: 'success', channel: 'dedicated_nuban', authorization: { account_number: '9912345678' } },
    ]);

    const result = await reconcileDvaInboundTransfers(ACCOUNT);

    expect(result.credited).toBe(0);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('continues past a single failed credit instead of dropping the rest', async () => {
    mockCredit
      .mockRejectedValueOnce(new Error('ledger down'))
      .mockResolvedValue({ alreadyProcessed: false, amountKobo: 0 });
    paystackTxns([dvaTxn('PSK_bad'), dvaTxn('PSK_good')]);

    const result = await reconcileDvaInboundTransfers(ACCOUNT);

    expect(result.credited).toBe(1);
    expect(mockCredit).toHaveBeenCalledTimes(2);
  });

  it('fails open (and moves nothing) when Paystack is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const result = await reconcileDvaInboundTransfers(ACCOUNT);

    expect(result).toEqual({ checked: 0, credited: 0 });
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('fails open on an API-level error or malformed reply', async () => {
    for (const body of [[], null]) {
      mockCredit.mockClear();
      paystackTxns(body as never[], false);
      expect((await reconcileDvaInboundTransfers(ACCOUNT)).credited).toBe(0);
    }
  });

  it('does nothing without a customer code or Paystack key', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect((await reconcileDvaInboundTransfers(ACCOUNT)).credited).toBe(0);

    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_stubbed');
    expect((await reconcileDvaInboundTransfers({ ...ACCOUNT, customer_code: null })).credited).toBe(0);
  });
});

describe('creditDvaInboundTransfer (shared webhook/reconcile credit)', () => {
  it('posts the credit under the webhook\'s exact idempotency key shape', async () => {
    await creditDvaInboundTransfer({
      userId: 'user-1',
      reference: 'PSK_x',
      amountKobo: 12_345,
      accountNumber: '9912345678',
    });

    expect(mockCredit).toHaveBeenCalledWith('user-1', {
      amountKobo: 12_345,
      reference: 'DVA:PSK_x',
      idempotencyKey: 'dva:PSK_x:CREDIT',
      description: 'Inbound transfer to virtual account 9912345678',
      metadata: { payment_reference: 'PSK_x', account_number: '9912345678' },
    });
  });
});

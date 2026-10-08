/**
 * AUD-FE-004 residual — bank-transfer verify-on-read.
 *
 * transfer.success / transfer.failed / transfer.reversed were webhook-only:
 * a dropped event left a wallet-to-bank transfer in a non-terminal state
 * forever (and, for failures, the sender's reserved funds unrefunded).
 * GET /api/v1/transfers/bank/:id is the status read a client already needs;
 * while the transfer is non-terminal it now asks Paystack (the authority) and
 * applies the outcome through the SAME shared settle the webhook runs — the
 * reversal legs carry the same `bank-transfer-refund:<id>:transfer.<event>`
 * idempotency key, so the two paths cannot double-refund.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

const db = vi.hoisted(() => ({
  transfer: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  ledgerInserts: [] as Record<string, unknown>[][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'bank_transfers') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: db.transfer, error: null }) }),
          }),
          update: (u: Record<string, unknown>) => {
            db.updates.push(u);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'ledger_accounts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: 'acct-sender' }, error: null }) }),
            }),
          }),
        };
      }
      if (table === 'ledger_entries') {
        return {
          insert: (legs: Record<string, unknown>[]) => {
            db.ledgerInserts.push(legs);
            return { select: async () => ({ data: legs.map((l, i) => ({ id: `le-${i}`, idempotency_key: l.idempotency_key })), error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/src/server/wallet/journal', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/src/server/wallet/journal');
  return { ...actual, getOrCreateStandingAccount: vi.fn(async () => 'acct-clearing') };
});

import { GET } from '../../../app/api/v1/transfers/bank/[id]/route';
import { requireRequestUser } from '@/src/lib/auth/request';

const USER = { id: 'user-1', email: 'u@example.com' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const pendingTransfer = {
  id: 'bt-1',
  user_id: 'user-1',
  status: 'provider_initiated',
  reference: 'BTF_ABC123',
  amount_kobo: 500_000,
  fee_kobo: 1_000,
  sender_entry_id: 'se-1',
  paystack_transfer_code: 'TRF_code_1',
  paystack_transfer_id: 12345,
};

function paystackTransfer(status: string, reference = 'BTF_ABC123', ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ status: ok, data: { status, reference, transfer_code: 'TRF_code_1' } }),
  })));
}

async function get(id = 'bt-1') {
  const res = await GET(new Request(`http://localhost/api/v1/transfers/bank/${id}`), params(id));
  return { res, body: await res.json() };
}

describe('GET /api/v1/transfers/bank/[id] — verify-on-read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.transfer = { ...pendingTransfer };
    db.updates = [];
    db.ledgerInserts = [];
    process.env.FEATURE_BANK_TRANSFERS_ENABLED = 'true';
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_stubbed');
    vi.mocked(requireRequestUser).mockResolvedValue(USER as never);
  });

  afterEach(() => {
    delete process.env.FEATURE_BANK_TRANSFERS_ENABLED;
  });

  it('settles a transfer Paystack reports as successful', async () => {
    paystackTransfer('success');

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('successful');
    expect(db.updates.at(-1)).toMatchObject({ status: 'successful' });
    expect(db.ledgerInserts).toHaveLength(0);
  });

  it('settles a failed transfer with the SAME refund idempotency key the webhook uses', async () => {
    paystackTransfer('failed');

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('failed');
    expect(db.updates.at(-1)).toMatchObject({ status: 'failed' });
    // Balanced reversal pair, keyed exactly like the webhook path so a late
    // transfer.failed webhook delivery no-ops on the same key.
    const legs = db.ledgerInserts[0];
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({
      idempotency_key: 'bank-transfer-refund:bt-1:transfer.failed',
      type: 'REVERSAL_DEBIT',
      amount_kobo: 501_000,
    });
    expect(legs[1]).toMatchObject({ type: 'REVERSAL_CREDIT', amount_kobo: 501_000 });
  });

  it('settles a provider reversal as reversed', async () => {
    paystackTransfer('reversed');

    const { body } = await get();

    expect(body.transfer.status).toBe('reversed');
    expect(db.ledgerInserts[0][0]).toMatchObject({
      idempotency_key: 'bank-transfer-refund:bt-1:transfer.reversed',
    });
  });

  it('leaves a still-pending provider transfer untouched', async () => {
    paystackTransfer('pending');

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('provider_initiated');
    expect(db.updates).toHaveLength(0);
  });

  it('does not call Paystack at all for an already-terminal transfer', async () => {
    db.transfer = { ...pendingTransfer, status: 'successful' };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('successful');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the stored status when Paystack is unreachable — never marks failed on silence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('provider_initiated');
    expect(db.updates).toHaveLength(0);
  });

  it('refuses to settle a provider reply whose reference does not match our transfer', async () => {
    paystackTransfer('success', 'BTF_DIFFERENT');

    const { body } = await get();

    expect(body.transfer.status).toBe('provider_initiated');
    expect(db.updates).toHaveLength(0);
  });

  it('returns the row without a provider call when the provider never issued a code', async () => {
    db.transfer = { ...pendingTransfer, paystack_transfer_code: null, paystack_transfer_id: null, status: 'funds_reserved' };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { res, body } = await get();

    expect(res.status).toBe(200);
    expect(body.transfer.status).toBe('funds_reserved');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s a transfer that is not the caller\'s', async () => {
    db.transfer = { ...pendingTransfer, user_id: 'someone-else' };

    const { res } = await get();

    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated and 503s when the flag is off', async () => {
    vi.mocked(requireRequestUser).mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    expect((await get()).res.status).toBe(401);

    delete process.env.FEATURE_BANK_TRANSFERS_ENABLED;
    expect((await get()).res.status).toBe(503);
  });
});

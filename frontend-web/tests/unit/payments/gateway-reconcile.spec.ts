/**
 * AUD-FE-003 residual — gateway reconciliation sweep.
 *
 * POST /api/v1/payments/gateway/reconcile is the backstop for charges whose
 * webhook never arrived AND whose client never came back: it scans the
 * pending-intent tables inside a grace/age window, asks Paystack whether each
 * reference actually collected, and re-drives shared fulfilment.
 *
 * Pins: pending-row collection across all four tables, verify-before-fulfil
 * (Paystack is the authority), unverified references skipped (left to age
 * out), reference dedup, fulfil failures reported as retryable, and the
 * shared-secret auth gate (closed when the env var is unset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/payments/gateway-fulfil', () => ({
  findGatewayFulfilmentTargets: vi.fn(async () => ({
    voteTransaction: null,
    registrationIntent: null,
    openmicIntent: { status: 'pending' },
  })),
  fulfilVerifiedGatewayCharge: vi.fn(async () => ({ fulfilled: ['open_mic_vote'] })),
}));

import { sweepGatewayIntents } from '@/src/server/payments/gateway-reconcile';
import { POST } from '../../../app/api/v1/payments/gateway/reconcile/route';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { fulfilVerifiedGatewayCharge } from '@/src/server/payments/gateway-fulfil';

/** Table-aware supabase stub: from(t) → chainable query ending in .limit(). */
function supabaseReturning(rowsByTable: Record<string, { refCol: string; rows: string[] }>) {
  return {
    from: vi.fn((table: string) => {
      const cfg = rowsByTable[table] ?? { refCol: 'reference', rows: [] };
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'lt', 'gt', 'order']) {
        chain[m] = vi.fn(() => chain);
      }
      chain.limit = vi.fn(async () => ({
        data: cfg.rows.map((r) => ({ [cfg.refCol]: r })),
        error: null,
      }));
      return chain;
    }),
  };
}

const FOUR_TABLES = {
  vote_transactions: { refCol: 'payment_reference', rows: ['vote-tx-1'] },
  registration_payment_intents: { refCol: 'reference', rows: ['reg-1'] },
  openmic_vote_paystack_intents: { refCol: 'reference', rows: ['om-1'] },
  academy_application_fee_intents: { refCol: 'reference', rows: ['acad-fee-1'] },
};

describe('sweepGatewayIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: 350_000,
      metadata: { purpose: 'paymax_gateway', custom_fields: [] },
    } as never);
  });

  it('verifies each pending reference with Paystack and fulfils the verified ones', async () => {
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning(FOUR_TABLES) as never);

    const result = await sweepGatewayIntents({ limit: 10, graceMs: 0, maxAgeMs: 3_600_000 });

    expect(result.scanned).toBe(4);
    expect(result.verified).toBe(4);
    expect(result.fulfilled).toEqual(['open_mic_vote', 'open_mic_vote', 'open_mic_vote', 'open_mic_vote']);
    for (const ref of ['vote-tx-1', 'reg-1', 'om-1', 'acad-fee-1']) {
      expect(verifyPaystackPayment).toHaveBeenCalledWith(ref);
      // Verified metadata rides along so metadata-resolved arms (academy
      // tuition instalments) can fulfil without a persisted reference.
      expect(fulfilVerifiedGatewayCharge).toHaveBeenCalledWith(
        ref,
        350_000,
        expect.objectContaining({ openmicIntent: expect.objectContaining({ status: 'pending' }) }),
        expect.objectContaining({ purpose: 'paymax_gateway' }),
        expect.objectContaining({}), // verified-charge details (providerReference/paidAt)
      );
    }
  });

  it('skips references Paystack did not confirm — no fulfil call', async () => {
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning(FOUR_TABLES) as never);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({ success: false } as never);

    const result = await sweepGatewayIntents({ graceMs: 0 });

    expect(result.scanned).toBe(4);
    expect(result.verified).toBe(0);
    expect(fulfilVerifiedGatewayCharge).not.toHaveBeenCalled();
  });

  it('dedups a reference that appears in more than one pending table', async () => {
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning({
      vote_transactions: { refCol: 'payment_reference', rows: ['shared-ref'] },
      registration_payment_intents: { refCol: 'reference', rows: ['shared-ref'] },
      openmic_vote_paystack_intents: { refCol: 'reference', rows: [] },
    }) as never);

    const result = await sweepGatewayIntents({ graceMs: 0 });

    expect(result.scanned).toBe(1);
    expect(vi.mocked(verifyPaystackPayment)).toHaveBeenCalledTimes(1);
  });

  it('reports fulfil failures as retryable instead of throwing', async () => {
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning(FOUR_TABLES) as never);
    vi.mocked(fulfilVerifiedGatewayCharge).mockResolvedValueOnce({
      fulfilled: [],
      error: 'draft update failed',
    } as never);

    const result = await sweepGatewayIntents({ graceMs: 0 });

    expect(result.failed).toEqual([{ reference: 'vote-tx-1', error: 'draft update failed' }]);
    expect(result.fulfilled.length).toBe(3);
  });

  it('passes the grace/age window to every pending-row query', async () => {
    const mock = supabaseReturning(FOUR_TABLES);
    vi.mocked(createAdminClient).mockReturnValue(mock as never);

    await sweepGatewayIntents({ graceMs: 60_000, maxAgeMs: 7_200_000, limit: 5 });

    const chain = mock.from.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(chain.lt).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(chain.gt).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(chain.limit).toHaveBeenCalledWith(5);
  });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/v1/payments/gateway/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));

describe('POST /api/v1/payments/gateway/reconcile', () => {
  const OLD_SECRET = process.env.GATEWAY_RECONCILE_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAdminClient).mockReturnValue(supabaseReturning({}) as never);
  });

  afterEach(() => {
    if (OLD_SECRET === undefined) delete process.env.GATEWAY_RECONCILE_SECRET;
    else process.env.GATEWAY_RECONCILE_SECRET = OLD_SECRET;
  });

  it('401s when GATEWAY_RECONCILE_SECRET is unset (endpoint off)', async () => {
    delete process.env.GATEWAY_RECONCILE_SECRET;
    const res = await post({}, { 'x-cron-secret': 'anything' });
    expect(res.status).toBe(401);
  });

  it('401s on a wrong secret, 200s on the right one', async () => {
    process.env.GATEWAY_RECONCILE_SECRET = 'test-secret';

    expect((await post({}, { 'x-cron-secret': 'wrong' })).status).toBe(401);

    const res = await post({ limit: 5 }, { 'x-cron-secret': 'test-secret' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.scanned).toBe(0);
  });
});

/**
 * Verify-on-read settlement for wallet top-ups.
 *
 * A Paystack webhook is best-effort. When it is delayed, dropped, or — as in
 * local development — undeliverable entirely, the intent stays `pending`, the
 * wallet is never credited, and the checkout that was waiting on it spins until
 * it times out. The customer has paid; the app cannot see it.
 *
 * So a pending intent is now resolved against Paystack's verify API, which is
 * the authority. The settlement itself is the SAME code the webhook runs, which
 * is what makes the two paths safe to race: both derive the ledger idempotency
 * key from the intent id, so the second one to arrive is a no-op.
 *
 * What these tests protect, in order of how much money is at stake:
 *   1. Only a Paystack-confirmed success ever credits.
 *   2. A credited intent is never credited twice, by either path.
 *   3. The amount Paystack actually collected must equal the intent, or nothing
 *      is credited — otherwise a divergence mints wallet balance.
 *   4. Only the intent's owner can trigger a verify.
 *   5. Every failure — network, API error, malformed reply — leaves the intent
 *      pending rather than crediting or corrupting it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/server/wallet/service', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/src/server/wallet/service');
  return { ...actual, creditWallet: vi.fn() };
});

import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet } from '@/src/server/wallet/service';
import { verifyAndSettleTopup } from '@/src/server/wallet/verify';

const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const mockCredit = creditWallet as ReturnType<typeof vi.fn>;

const REF = 'TOPUP_D5DF66FBB29F4647';
const USER = '9b4c58b4-e2ef-4fd6-8667-9ba265b5a50a';
const INTENT_ID = '0e27de30-eb67-45c4-8ac9-5856d77bce15';
const KOBO = 1_000_000;

let updates: Record<string, unknown>[] = [];

function makeSupabase(intent: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: intent, error: null }) }),
      }),
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
}

function paystackReplies(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })));
}

const pendingIntent = {
  id: INTENT_ID, user_id: USER, amount_kobo: KOBO, status: 'pending',
};

const success = {
  status: true,
  data: { status: 'success', amount: KOBO, reference: REF, currency: 'NGN' },
};

beforeEach(() => {
  // The fallback needs a configured provider to ask; the fetch itself is stubbed.
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_stubbed_not_a_real_key');
  updates = [];
  mockCredit.mockReset().mockResolvedValue({ alreadyProcessed: false, amountKobo: KOBO });
  mockAdmin.mockReset().mockReturnValue(makeSupabase(pendingIntent));
});

describe('verifyAndSettleTopup', () => {
  it('credits a pending intent that Paystack confirms as paid', async () => {
    paystackReplies(success);

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(true);
    expect(mockCredit).toHaveBeenCalledTimes(1);
    const [userId, input] = mockCredit.mock.calls[0];
    expect(userId).toBe(USER);
    expect(input.amountKobo).toBe(KOBO);
    // The SAME key the webhook builds — this is what makes the paths safe to race.
    expect(input.idempotencyKey).toBe(`topup:${INTENT_ID}:CREDIT`);
    expect(updates.at(-1)).toMatchObject({ status: 'completed' });
  });

  it('does not credit when Paystack reports anything other than success', async () => {
    for (const status of ['failed', 'abandoned', 'pending', 'reversed', 'ongoing']) {
      mockCredit.mockClear();
      paystackReplies({ status: true, data: { status, amount: KOBO, reference: REF } });

      const result = await verifyAndSettleTopup(REF, USER);

      expect(result.settled, `status=${status}`).toBe(false);
      expect(mockCredit, `status=${status}`).not.toHaveBeenCalled();
    }
  });

  it('never credits an intent that is already completed', async () => {
    mockAdmin.mockReturnValue(makeSupabase({ ...pendingIntent, status: 'completed' }));
    paystackReplies(success);

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(true);   // already money in the wallet
    expect(result.alreadySettled).toBe(true);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('refuses when the collected amount differs from the intent', async () => {
    paystackReplies({ status: true, data: { status: 'success', amount: KOBO - 1, reference: REF } });

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
    // Recorded, not silently ignored: a mismatch is a real incident.
    expect(updates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('refuses a non-integer amount rather than crediting a fraction', async () => {
    paystackReplies({ status: true, data: { status: 'success', amount: 999_999.5, reference: REF } });

    expect((await verifyAndSettleTopup(REF, USER)).settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('refuses to settle another user\'s intent', async () => {
    paystackReplies(success);

    const result = await verifyAndSettleTopup(REF, 'a-different-user-00000000000000000000');

    expect(result.settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('leaves the intent pending when Paystack is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
    // Must NOT mark failed — the payment may well have succeeded.
    expect(updates).toEqual([]);
  });

  it('leaves the intent pending on an API error or malformed reply', async () => {
    for (const body of [{ status: false, message: 'Invalid key' }, {}, { data: null }, { data: {} }]) {
      updates = [];
      mockCredit.mockClear();
      paystackReplies(body);

      expect((await verifyAndSettleTopup(REF, USER)).settled).toBe(false);
      expect(mockCredit).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    }
  });

  it('reports not-settled for an unknown reference without throwing', async () => {
    mockAdmin.mockReturnValue(makeSupabase(null));
    paystackReplies(success);

    expect((await verifyAndSettleTopup(REF, USER)).settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('re-verifies a failed intent, so a transient error cannot strand real money', async () => {
    mockAdmin.mockReturnValue(makeSupabase({ ...pendingIntent, status: 'failed' }));
    paystackReplies(success);

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(true);
    expect(mockCredit).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({ status: 'completed' });
  });

  it('a genuinely mismatched intent simply fails again, moving nothing', async () => {
    mockAdmin.mockReturnValue(makeSupabase({ ...pendingIntent, status: 'failed' }));
    paystackReplies({ status: true, data: { status: 'success', amount: KOBO - 1, reference: REF } });

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(false);
    expect(mockCredit).not.toHaveBeenCalled();
  });

  it('treats a ledger-level duplicate as settled, not as a new credit', async () => {
    mockCredit.mockResolvedValue({ alreadyProcessed: true, amountKobo: KOBO });
    paystackReplies(success);

    const result = await verifyAndSettleTopup(REF, USER);

    expect(result.settled).toBe(true);
    expect(updates.at(-1)).toMatchObject({ status: 'completed' });
  });
});

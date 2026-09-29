// Regression for a real incident (2026-09-18): a cable_tv purchase whose
// Paystack charge succeeds but whose customer/meter VALIDATION fails throws
// inside payUtility BEFORE any utility_transactions row is created. Unlike a
// provider-vend failure (which payUtility's own reversal branch refunds —
// see paystack-refund.spec.ts), this throw happens even earlier: there is no
// transaction row for that branch to act on, so the money was captured with
// NO record and NO refund at all. verifyUtilityPaystackPayment must catch
// this itself and refund + mark the INTENT failed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn(),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/utility/service', () => ({
  payUtility: vi.fn(),
  quoteUtilityPayment: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { payUtility } from '@/src/server/utility/service';
import { creditWallet } from '@/src/server/wallet/service';
import { ApiError } from '@/src/lib/api/responses';
import { verifyUtilityPaystackPayment } from '@/app/api/v1/utility/paystack/_service';

const REFERENCE = 'UTIL_TESTREF123';
const USER_ID = 'user-cable-001';

const INTENT = {
  id: 'intent-001',
  user_id: USER_ID,
  category: 'cable_tv',
  biller_id: 'biller-dstv',
  product_id: 'product-dstv',
  customer_reference: '1212121212',
  amount_kobo: 500_000,
  retail_amount_kobo: 500_000,
  payment_reference: REFERENCE,
  status: 'pending',
  transaction_id: null,
  metadata: {},
};

function makeFakeSupabase(intent: Record<string, unknown>) {
  const state = { intent: { ...intent } };
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn((payload: any) => {
      state.intent = { ...state.intent, ...payload };
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: state.intent, error: null })),
  };
  return { from: vi.fn(() => builder), _state: state };
}

describe('verifyUtilityPaystackPayment — payUtility throws before creating a transaction', () => {
  let fakeSupabase: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSupabase = makeFakeSupabase(INTENT);
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase as any);
    vi.mocked(verifyPaystackPayment).mockResolvedValue({
      success: true,
      amountKobo: INTENT.retail_amount_kobo,
      providerReference: 'paystack-ref-1',
    } as any);
    vi.mocked(payUtility).mockRejectedValue(new ApiError('Customer validation failed.', 400));
  });

  it('refunds the captured Paystack amount into the wallet', async () => {
    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();

    expect(creditWallet).toHaveBeenCalledTimes(1);
    expect(creditWallet).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      amountKobo: 500_000,
    }));
  });

  it('marks the intent failed (not left stuck pending forever)', async () => {
    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();
    expect(fakeSupabase._state.intent.status).toBe('failed');
    expect(fakeSupabase._state.intent.failure_reason).toBeTruthy();
  });

  it('is idempotent — refunding twice for the same intent never double-credits', async () => {
    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();
    const firstCall = vi.mocked(creditWallet).mock.calls[0];

    vi.mocked(creditWallet).mockClear();
    await expect(verifyUtilityPaystackPayment(REFERENCE)).rejects.toThrow();
    const secondCall = vi.mocked(creditWallet).mock.calls[0];

    // Same idempotency key both times — creditWallet's own idempotency guard
    // (checkIdempotencyKey) is what actually prevents the double-credit; this
    // just proves the KEY stays stable across retries so that guard can work.
    expect(secondCall[1].idempotencyKey).toBe(firstCall[1].idempotencyKey);
  });
});

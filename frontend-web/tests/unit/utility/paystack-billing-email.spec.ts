/**
 * Utility Paystack initiate — billing-email resolution.
 *
 * Endpoint under test: initiateUtilityPaystackPayment (app/api/v1/utility/paystack/_service.ts)
 *
 * Paystack refuses every address it cannot route (phone-only signups have no
 * session email; fixture accounts carry placeholder TLDs like .internal) with
 * `"email" must be a valid email`. The lane used to forward the raw session
 * email anyway, so the member got an opaque 502 "Paystack initialization
 * failed" — and because the intent row was written BEFORE that call, the
 * attempt left a `pending` row with a NULL authorization_url behind, burning
 * its idempotency key.
 *
 * The wallet top-up lane already answers this with resolveBillingEmail
 * (src/server/wallet/service.ts): session email → profile email → actionable
 * 400. This spec pins that the utility lane uses the same rule and applies it
 * before anything is persisted.
 *
 * Hermetic: auth, persistence, pricing, gate and Paystack are mocked. No DB, no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(),
  resolveBillingEmail: vi.fn(),
}));

vi.mock('@/src/server/utility/service', () => ({
  quoteUtilityPayment: vi.fn(),
}));

vi.mock('@/src/server/utility/payment-gate', () => ({
  enforceUtilityPaymentGate: vi.fn(),
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
import { resolveBillingEmail } from '@/src/server/wallet/service';
import { quoteUtilityPayment } from '@/src/server/utility/service';
import { enforceUtilityPaymentGate } from '@/src/server/utility/payment-gate';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';
import { ApiError } from '@/src/lib/api/responses';
import { initiateUtilityPaystackPayment } from '@/app/api/v1/utility/paystack/_service';

const USER_ID = 'user-email-001';

// Minimal fake: only the intent table is touched on this path. Inserts are
// recorded so a test can prove a refused request persisted nothing.
function makeFakeSupabase() {
  const intents = new Map<string, Record<string, unknown>>();
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn((payload: Record<string, unknown>) => {
      intents.set(String(payload.id), { ...payload });
      return builder;
    }),
    update: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (onFulfilled: any) => Promise.resolve({ data: null, error: null }).then(onFulfilled),
  };
  return { from: vi.fn(() => builder), _intents: intents };
}

function initiateInput(email: string) {
  return {
    request: new Request('https://app.test/api/v1/utility/paystack/initiate', { method: 'POST' }),
    userId: USER_ID,
    email,
    category: 'airtime' as const,
    billerId: 'biller-001',
    productId: 'product-001',
    customerReference: '+2348011111111',
    amountKobo: 500_000,
    metadata: {},
    idempotencyKey: 'idem-email-key',
  };
}

describe('initiateUtilityPaystackPayment — billing email', () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = makeFakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(fake as any);
    vi.mocked(quoteUtilityPayment).mockResolvedValue({
      pricing: { amountKobo: 500_000, retailAmountKobo: 500_000 },
    } as any);
    vi.mocked(enforceUtilityPaymentGate).mockResolvedValue(undefined as any);
    vi.mocked(initializePaystackPayment).mockResolvedValue('https://checkout.paystack.com/issued');
    vi.mocked(resolveBillingEmail).mockResolvedValue('member@example.com');
  });

  it('bills Paystack with the resolved address, never the raw session email', async () => {
    await initiateUtilityPaystackPayment(initiateInput(''));

    expect(resolveBillingEmail).toHaveBeenCalledWith(USER_ID, '', expect.any(String));
    expect(initializePaystackPayment).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'member@example.com' }),
    );
  });

  it('answers the email rule before the intent row is written, so a refusal strands nothing', async () => {
    vi.mocked(resolveBillingEmail).mockRejectedValue(
      new ApiError('A valid email address is required to pay bills.', 400),
    );

    await expect(initiateUtilityPaystackPayment(initiateInput(''))).rejects.toMatchObject({
      status: 400,
    });

    expect(initializePaystackPayment).not.toHaveBeenCalled();
    expect(fake._intents.size).toBe(0);
  });

  it('never reaches the gateway when the address is unresolvable, even after the gate passes', async () => {
    vi.mocked(resolveBillingEmail).mockRejectedValue(
      new ApiError('A valid email address is required to pay bills.', 400),
    );

    await expect(initiateUtilityPaystackPayment(initiateInput('qa@spotlight.internal'))).rejects.toMatchObject({
      status: 400,
    });

    expect(enforceUtilityPaymentGate).toHaveBeenCalled();
    expect(fake._intents.size).toBe(0);
  });
});

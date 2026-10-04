/**
 * AUD-FE-003 residual — registration fee initiation.
 *
 * The wizards used to charge Paystack directly with a client-minted reference
 * and a client-declared amount; a charge whose submit never arrived was
 * orphaned — no pending record for the webhook/recover/sweep path to settle.
 *
 * These specs pin the contract POST /payment/initiate now provides:
 *   - the intent row is persisted BEFORE the client pays and the minted
 *     reference + server-quoted amountKobo are returned (never a client amount);
 *   - inline: true skips the server-side transaction/initialize so the
 *     reference is NOT double-registered at Paystack when PaystackPop's
 *     newTransaction opens the inline popup with it;
 *   - the default (hosted) mode still initializes and returns
 *     authorizationUrl;
 *   - Idempotency-Key replays return the same intent; an already-paid
 *     application short-circuits to status 'completed' with no new charge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/server', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'user-1', email: 'user@test.dev' } })),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: vi.fn(async () => 'https://checkout.paystack.com/hosted-abc'),
}));

vi.mock('@/src/server/registration/return-origin', () => ({
  resolveReturnOrigin: vi.fn(() => null),
}));

const draft = {
  id: 'app-1',
  userId: 'user-1',
  contestSlug: 'reality-tv-show',
  formData: { 'payment.feeAmount': 5000 },
};

const store = vi.hoisted(() => ({
  getRegistrationDraft: vi.fn(async (): Promise<any> => null),
  findRegistrationPaymentIntentByIdempotencyKey: vi.fn(async (): Promise<any> => null),
  getRegistrationPaymentIntentByApplicationAndMethod: vi.fn(async (): Promise<any> => null),
  createRegistrationPaymentIntent: vi.fn(),
  retryRegistrationPaymentIntent: vi.fn(),
}));

vi.mock('@/src/server/registration/supabase-store', () => store);

import { POST } from '@/app/api/registration/applications/[id]/payment/initiate/route';
import { initializePaystackPayment } from '@/src/server/voting/payment/paystack';

const ctx = { params: Promise.resolve({ id: 'app-1' }) };

function req(body: unknown, idempotencyKey = 'idem-1') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return new Request('https://app.test/api/registration/applications/app-1/payment/initiate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/registration/applications/[id]/payment/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getRegistrationDraft.mockResolvedValue(draft);
    store.findRegistrationPaymentIntentByIdempotencyKey.mockResolvedValue(null);
    store.getRegistrationPaymentIntentByApplicationAndMethod.mockResolvedValue(null);
    store.createRegistrationPaymentIntent.mockImplementation(async (args: any) => ({
      id: 'intent-1',
      ...args,
    }));
    store.retryRegistrationPaymentIntent.mockImplementation(async (id: string, args: any) => ({
      id,
      ...args,
    }));
  });

  it('rejects without an Idempotency-Key', async () => {
    const res = await POST(req({ method: 'PAYSTACK', inline: true }, ''), ctx);
    expect(res.status).toBe(400);
    expect(store.createRegistrationPaymentIntent).not.toHaveBeenCalled();
  });

  it('inline mode persists the intent and skips server-side initialize', async () => {
    const res = await POST(req({ method: 'PAYSTACK', email: 'payer@test.dev', inline: true }), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(store.createRegistrationPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-1',
        amountKobo: 500_000, // 5000 NGN quoted server-side, never from the client
        idempotencyKey: 'idem-1',
      }),
    );
    expect(body.reference).toMatch(/^SPT-REG-/);
    expect(body.amountKobo).toBe(500_000);
    expect(body.status).toBe('initiated');
    expect(body.authorizationUrl).toBeUndefined();
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('hosted mode initializes at Paystack and returns authorizationUrl', async () => {
    const res = await POST(req({ method: 'PAYSTACK', email: 'payer@test.dev' }), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(initializePaystackPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500_000, currency: 'NGN' }),
    );
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/hosted-abc');
  });

  it('replays the same intent for a repeated Idempotency-Key', async () => {
    store.findRegistrationPaymentIntentByIdempotencyKey.mockResolvedValueOnce({
      id: 'intent-old',
      paymentReference: 'SPT-REG-OLD',
      amountKobo: 500_000,
      status: 'initiated',
    });
    const res = await POST(req({ method: 'PAYSTACK', inline: true }), ctx);
    const body = await res.json();

    expect(body.reference).toBe('SPT-REG-OLD');
    expect(store.createRegistrationPaymentIntent).not.toHaveBeenCalled();
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('short-circuits to completed for an already-paid application', async () => {
    store.getRegistrationPaymentIntentByApplicationAndMethod.mockResolvedValueOnce({
      id: 'intent-paid',
      paymentReference: 'SPT-REG-PAID',
      amountKobo: 500_000,
      status: 'completed',
    });
    const res = await POST(req({ method: 'PAYSTACK', inline: true }), ctx);
    const body = await res.json();

    expect(body.status).toBe('completed');
    expect(body.reference).toBe('SPT-REG-PAID');
    expect(store.createRegistrationPaymentIntent).not.toHaveBeenCalled();
    expect(initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('rejects when the draft carries no outstanding fee', async () => {
    store.getRegistrationDraft.mockResolvedValueOnce({
      ...draft,
      formData: { 'payment.feeAmount': 0 },
    });
    const res = await POST(req({ method: 'PAYSTACK', inline: true }), ctx);
    expect(res.status).toBe(400);
    expect(store.createRegistrationPaymentIntent).not.toHaveBeenCalled();
  });
});

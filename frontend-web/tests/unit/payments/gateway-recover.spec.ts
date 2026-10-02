/**
 * AUD-FE-004 residual — gateway charge self-heal.
 *
 * paymax_gateway charges are client-initialized: if the app crashed between
 * Paystack collecting and the domain verify call, and the webhook also failed,
 * the money was stranded with no caller-driven recovery. POST
 * /api/v1/payments/gateway/recover is the verify-on-read mirror: a signed-in
 * user re-drives fulfilment for a reference by asking Paystack (the authority)
 * and running the same shared domain fulfilment the webhook runs — idempotent,
 * so it is also a safe no-op on an already-settled charge.
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

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackPayment: vi.fn(async () => ({ success: true, amountKobo: 250_000 })),
}));

vi.mock('@/src/server/payments/gateway-fulfil', () => ({
  findGatewayFulfilmentTargets: vi.fn(async () => ({
    voteTransaction: null,
    registrationIntent: { id: 'intent-1', status: 'initiated' },
  })),
  fulfilVerifiedGatewayCharge: vi.fn(async () => ({ fulfilled: ['registration_fee'] })),
}));

import { POST } from '../../../app/api/v1/payments/gateway/recover/route';
import { requireRequestUser } from '@/src/lib/auth/request';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import {
  findGatewayFulfilmentTargets,
  fulfilVerifiedGatewayCharge,
} from '@/src/server/payments/gateway-fulfil';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/v1/payments/gateway/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRequestUser).mockResolvedValue({ id: 'user-1' } as never);
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true } as never);
});

describe('POST /api/v1/payments/gateway/recover', () => {
  it('re-verifies with Paystack and re-drives domain fulfilment', async () => {
    const res = await post({ reference: 'PAY_gw_1' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(verifyPaystackPayment).toHaveBeenCalledWith('PAY_gw_1');
    expect(fulfilVerifiedGatewayCharge).toHaveBeenCalledWith(
      'PAY_gw_1',
      250_000,
      expect.objectContaining({ registrationIntent: expect.objectContaining({ id: 'intent-1' }) }),
      expect.objectContaining({}), // verified-charge details (providerReference/paidAt)
    );
    expect(body.fulfilled).toEqual(['registration_fee']);
  });

  it('reports verified:false without fulfilling when Paystack has no successful charge', async () => {
    vi.mocked(verifyPaystackPayment).mockResolvedValueOnce({ success: false, amountKobo: 0 } as never);

    const res = await post({ reference: 'PAY_unpaid' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verified).toBe(false);
    expect(fulfilVerifiedGatewayCharge).not.toHaveBeenCalled();
  });

  it('returns 500 when fulfilment fails so the caller can retry', async () => {
    vi.mocked(fulfilVerifiedGatewayCharge).mockResolvedValueOnce({
      fulfilled: [],
      error: 'draft update failed',
    });

    const res = await post({ reference: 'PAY_gw_1' });

    expect(res.status).toBe(500);
  });

  it('400s without a reference, 401s when unauthenticated, 429s when rate-limited', async () => {
    expect((await post({})).status).toBe(400);

    vi.mocked(requireRequestUser).mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    expect((await post({ reference: 'r' })).status).toBe(401);

    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false } as never);
    expect((await post({ reference: 'r' })).status).toBe(429);
  });
});

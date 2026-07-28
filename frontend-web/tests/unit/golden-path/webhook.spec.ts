/**
 * Golden-path suite: POST /api/webhooks/paystack
 *
 * The webhook route always returns 200 — a non-200 response would cause
 * Paystack to retry the delivery. Internal processing results are surfaced
 * through the body flags (processed, duplicate).
 *
 * Protected source: frontend-web/app/api/webhooks/paystack/route.ts (DO NOT EDIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWebhookResult } from './_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/src/server/voting/payment/webhook', () => ({
  handlePaystackWebhook: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from '../../../app/api/webhooks/paystack/route';
import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWebhookRequest(
  payload: Record<string, unknown>,
  signature = 'sha512=valid-signature',
): Request {
  const body = JSON.stringify(payload);
  return new Request('http://localhost/api/webhooks/paystack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature,
    },
    body,
  });
}

function makeChargeSuccessPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'charge.success',
    data: {
      reference: 'PAY_ref_abc123',
      amount: 50000, // kobo
      currency: 'NGN',
      status: 'success',
      customer: { email: 'voter@example.com' },
      ...overrides,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/paystack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 with processed:true for a valid charge.success event', async () => {
    vi.mocked(handlePaystackWebhook).mockResolvedValue(makeWebhookResult());

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.processed).toBe(true);
    expect(body.duplicate).toBe(false);
  });

  it('should return 200 with duplicate:true for a replayed event', async () => {
    vi.mocked(handlePaystackWebhook).mockResolvedValue(
      makeWebhookResult({ duplicate: true, processed: false }),
    );

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));
    const body = await res.json();

    expect(res.status).toBe(200); // always 200 to Paystack
    expect(body.received).toBe(true);
    expect(body.duplicate).toBe(true);
    expect(body.processed).toBe(false);
  });

  it('should return 200 with processed:false for an invalid signature', async () => {
    vi.mocked(handlePaystackWebhook).mockResolvedValue(
      makeWebhookResult({ processed: false, duplicate: false }),
    );

    const res = await POST(
      makeWebhookRequest(makeChargeSuccessPayload(), 'sha512=bad-signature'),
    );
    const body = await res.json();

    expect(res.status).toBe(200); // always 200 — never break Paystack retry logic
    expect(body.received).toBe(true);
    expect(body.processed).toBe(false);
  });

  it('should return 200 with processed:true for non-charge.success events (safely ignored)', async () => {
    // transfer.success, refund.processed, etc. are received but not acted on
    vi.mocked(handlePaystackWebhook).mockResolvedValue(
      makeWebhookResult({ processed: true, duplicate: false }),
    );

    const res = await POST(
      makeWebhookRequest({ event: 'transfer.success', data: { reference: 'TRF_abc' } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
  });

  it('should always return 200 even when the handler throws internally', async () => {
    // The webhook handler wraps errors and returns a safe result; the route
    // must never propagate an exception as a non-200 to Paystack.
    vi.mocked(handlePaystackWebhook).mockResolvedValue(
      makeWebhookResult({ processed: false }),
    );

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});

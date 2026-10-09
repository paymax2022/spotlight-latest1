/**
 * Golden-path suite: POST /api/webhooks/paystack
 *
 * The route verifies the HMAC signature over the raw body BEFORE dispatch —
 * a bad signature is a uniform 401 no matter what the payload claims (a
 * junk-signed Go-owned prefix used to be forwarded to the internal receiver
 * and the 500-vs-200 differential leaked which prefixes Go owns). Malformed
 * bodies (incl. the JSON literal `null`, which parses cleanly then TypeErrors
 * downstream) are a 400, never a 500.
 *
 * For signed, well-formed payloads the route returns 200 whenever every
 * handler SETTLED (fulfilled or a routine irrelevant-event skip). AUD-REL-002
 * changed the contract for real failures: a handler that REJECTS now surfaces
 * 500 (Paystack retries — safe, each handler dedups) and ALL seven rejecting
 * returns 400 (malformed payload). The always-200 pin was the bug: thrown
 * handler failures were acked and dropped forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWebhookResult } from './_fixtures';

// All seven co-tenant handlers are mocked — this spec tests the ROUTE's dispatch
// and status contract, not the handlers (the real gateway handler throws when
// PAYSTACK_SECRET_KEY is unset in the test env, which would poison every case).

// The route's pre-dispatch signature gate is mocked so each test controls
// validity directly (PAYSTACK_SECRET_KEY is unset in the test env).
vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackWebhookSignature: vi.fn(() => true),
  verifyPaystackPayment: vi.fn(),
}));

vi.mock('@/src/server/voting/payment/webhook', () => ({
  handlePaystackWebhook: vi.fn(),
}));

vi.mock('@/src/server/wallet/webhook', () => ({
  handleWalletTopupWebhook: vi.fn(),
}));

vi.mock('@/src/server/virtual-accounts/webhook', () => ({
  handleDvaTransferWebhook: vi.fn(),
}));

vi.mock('../../../app/api/webhooks/paystack/utility-handler', () => ({
  handleUtilityPaystackWebhook: vi.fn(),
}));

vi.mock('@/src/server/transfers/bank-webhook', () => ({
  handleBankTransferWebhook: vi.fn(),
}));

vi.mock('../../../app/api/webhooks/paystack/gateway-handler', () => ({
  handleGatewayPaystackWebhook: vi.fn(),
}));

vi.mock('../../../app/api/webhooks/paystack/go-forward', () => ({
  forwardGoOwnedPaystackEvent: vi.fn(),
}));

import { POST } from '../../../app/api/webhooks/paystack/route';
import { verifyPaystackWebhookSignature } from '@/src/server/voting/payment/paystack';
import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';
import { handleUtilityPaystackWebhook } from '../../../app/api/webhooks/paystack/utility-handler';
import { handleBankTransferWebhook } from '@/src/server/transfers/bank-webhook';
import { handleGatewayPaystackWebhook } from '../../../app/api/webhooks/paystack/gateway-handler';
import { forwardGoOwnedPaystackEvent } from '../../../app/api/webhooks/paystack/go-forward';

const ALL_HANDLERS = [
  handlePaystackWebhook,
  handleWalletTopupWebhook,
  handleDvaTransferWebhook,
  handleUtilityPaystackWebhook,
  handleBankTransferWebhook,
  handleGatewayPaystackWebhook,
  forwardGoOwnedPaystackEvent,
];

function makeWebhookRequest(
  payload: Record<string, unknown>,
  signature = 'sha512=valid-signature',
): Request {
  return makeRawWebhookRequest(JSON.stringify(payload), signature);
}

function makeRawWebhookRequest(
  body: string,
  signature = 'sha512=valid-signature',
): Request {
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

describe('POST /api/webhooks/paystack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyPaystackWebhookSignature).mockReturnValue(true);
    // each test overrides the handler it exercises.
    for (const h of ALL_HANDLERS) {
      vi.mocked(h).mockResolvedValue({ processed: false, duplicate: false });
    }
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

  it('returns a uniform 401 for an invalid signature — before ANY dispatch', async () => {
    vi.mocked(verifyPaystackWebhookSignature).mockReturnValue(false);

    const res = await POST(
      makeWebhookRequest(makeChargeSuccessPayload(), 'sha512=bad-signature'),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.received).toBe(false);
    for (const h of ALL_HANDLERS) {
      expect(h).not.toHaveBeenCalled();
    }
  });

  it('rejects a junk-signed Go-owned reference identically — no prefix oracle', async () => {
    // A `feespay:`/`duespay:`/`foodorder:`/`rideorder:` reference used to be
    // forwarded to the internal Go receiver before any local signature check,
    // and the 500-vs-200 differential leaked the Go-owned prefix list.
    vi.mocked(verifyPaystackWebhookSignature).mockReturnValue(false);

    const res = await POST(
      makeWebhookRequest(makeChargeSuccessPayload({ reference: 'feespay:forged' }), 'junk'),
    );

    expect(res.status).toBe(401);
    expect(forwardGoOwnedPaystackEvent).not.toHaveBeenCalled();
  });

  it('returns 400 for a literal `null` body — malformed, never a 500', async () => {
    // JSON.parse('null') succeeds and then TypeErrors on property access inside
    // the handlers — the old code surfaced that as a retryable 500.
    const res = await POST(makeRawWebhookRequest('null'));

    expect(res.status).toBe(400);
    for (const h of ALL_HANDLERS) {
      expect(h).not.toHaveBeenCalled();
    }
  });

  it.each(['not-json{', '5', '"just a string"', 'true'])(
    'returns 400 for a signed but non-event body: %s',
    async (raw) => {
      const res = await POST(makeRawWebhookRequest(raw));

      expect(res.status).toBe(400);
      for (const h of ALL_HANDLERS) {
        expect(h).not.toHaveBeenCalled();
      }
    },
  );

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

  it('returns 200 when a handler resolves with a routine failure result', async () => {
    // Handlers signal failure by RESULT, not throw — a resolved {processed:false}
    // (bad signature, irrelevant event, already-settled intent) stays a 200.
    vi.mocked(handlePaystackWebhook).mockResolvedValue(
      makeWebhookResult({ processed: false }),
    );

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it('returns 500 when a handler REJECTS so Paystack retries the delivery', async () => {
    // AUD-REL-002: a thrown handler used to be acked 200 and dropped forever.
    // Rejection = real failure (bug/DB/provider) → retryable. Co-tenant
    // handlers are idempotent, so redelivery is safe for the ones that ran.
    vi.mocked(handleGatewayPaystackWebhook).mockRejectedValue(new Error('db timeout'));

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.processed).toBe(false);
  });

  it('returns 400 when EVERY handler rejects (malformed payload — retry is pointless)', async () => {
    for (const h of ALL_HANDLERS) {
      vi.mocked(h).mockRejectedValue(new Error('boom'));
    }

    const res = await POST(makeWebhookRequest(makeChargeSuccessPayload()));

    expect(res.status).toBe(400);
  });
});

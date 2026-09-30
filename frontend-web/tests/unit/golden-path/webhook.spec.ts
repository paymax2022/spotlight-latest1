/**
 * Golden-path suite: POST /api/webhooks/paystack
 *
 * The webhook route returns 200 whenever every handler SETTLED (fulfilled or
 * a routine irrelevant-event skip). AUD-REL-002 changed the contract for real
 * failures: a handler that REJECTS now surfaces 500 (Paystack retries — safe,
 * each handler dedups) and ALL six rejecting returns 400 (malformed payload).
 * The always-200 pin was the bug: thrown handler failures were acked and
 * dropped forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeWebhookResult } from './_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────
// All six co-tenant handlers are mocked — this spec tests the ROUTE's dispatch
// and status contract, not the handlers (the real gateway handler throws when
// PAYSTACK_SECRET_KEY is unset in the test env, which would poison every case).

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

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from '../../../app/api/webhooks/paystack/route';
import { handlePaystackWebhook } from '@/src/server/voting/payment/webhook';
import { handleWalletTopupWebhook } from '@/src/server/wallet/webhook';
import { handleDvaTransferWebhook } from '@/src/server/virtual-accounts/webhook';
import { handleUtilityPaystackWebhook } from '../../../app/api/webhooks/paystack/utility-handler';
import { handleBankTransferWebhook } from '@/src/server/transfers/bank-webhook';
import { handleGatewayPaystackWebhook } from '../../../app/api/webhooks/paystack/gateway-handler';

const ALL_HANDLERS = [
  handlePaystackWebhook,
  handleWalletTopupWebhook,
  handleDvaTransferWebhook,
  handleUtilityPaystackWebhook,
  handleBankTransferWebhook,
  handleGatewayPaystackWebhook,
];

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
    // Default every co-tenant handler to a fulfilled irrelevant-event skip;
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

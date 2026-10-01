/**
 * AUD-FE-004 / AUD-FE-003 residuals — gateway webhook handler.
 *
 * (a) The gateway and vote handlers used to share ONE payment_webhook_logs row
 *     keyed (provider, reference, event_type). For a `paymax_gateway`
 *     charge.success, whichever handler marked `processed` first made the other
 *     return `duplicate` and skip verification entirely — a race inside the
 *     dispatcher's parallel allSettled fan-out. The vote handler file is
 *     protected legacy, so the gateway handler now scopes its dedup key to
 *     `gateway:<event>` — each handler domain owns its own row.
 *
 * (c) Gateway fulfilment beyond votes: server-initiated registration fee
 *     charges (metadata.type='registration_payment', or no marker at all) were
 *     never claimed — fulfilment depended on the browser reaching the verify
 *     endpoint. The handler now claims any charge.success that has a pending
 *     reference-keyed fulfilment record and settles it server-side, idempotently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  voteTx: null as { id: string; vote_credit_status: string } | null,
  // Rows the dedup select can see, keyed by the event_type filter the handler
  // sent — simulates the vote handler owning a `charge.success` row while the
  // gateway's `gateway:charge.success` row may or may not exist.
  logRows: {} as Record<string, { id: string; processed: boolean } | undefined>,
  eventTypeFilters: [] as string[],
  upserts: [] as Record<string, unknown>[],
  logUpdates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'vote_transactions') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.voteTx, error: null }) }),
          }),
        };
      }
      if (table === 'payment_webhook_logs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: (_f: string, eventType: string) => {
                  state.eventTypeFilters.push(eventType);
                  return {
                    maybeSingle: async () => ({ data: state.logRows[eventType] ?? null, error: null }),
                  };
                },
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => {
            state.upserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }) };
          },
          update: (u: Record<string, unknown>) => {
            state.logUpdates.push(u);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock('@/src/server/voting/payment/paystack', () => ({
  verifyPaystackWebhookSignature: vi.fn(() => true),
  verifyPaystackPayment: vi.fn(async () => ({ success: true, amountKobo: 250_000 })),
}));

vi.mock('@/src/server/voting-bridge/bridge', () => ({
  bridgedVerifyPaidVote: vi.fn(async () => ({ success: true, voteId: 'v1', totalVotes: 10 })),
}));

const registrationStore = vi.hoisted(() => ({
  intent: null as {
    id: string;
    applicationId: string;
    amountKobo: number;
    method: 'PAYSTACK';
    paymentReference: string;
    idempotencyKey: string;
    status: 'initiated' | 'completed' | 'verified' | 'failed';
    createdAt: string;
    updatedAt: string;
  } | null,
}));

vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationPaymentIntentByReference: vi.fn(async () => registrationStore.intent),
  applyRegistrationPaymentSuccess: vi.fn(async () => ({})),
  markRegistrationPaymentIntentStatus: vi.fn(async () => ({})),
}));

import { handleGatewayPaystackWebhook } from '../../../app/api/webhooks/paystack/gateway-handler';
import { verifyPaystackPayment } from '@/src/server/voting/payment/paystack';
import { bridgedVerifyPaidVote } from '@/src/server/voting-bridge/bridge';
import {
  getRegistrationPaymentIntentByReference,
  applyRegistrationPaymentSuccess,
  markRegistrationPaymentIntentStatus,
} from '@/src/server/registration/supabase-store';

const markedCharge = (reference = 'PAY_gw_1') =>
  JSON.stringify({
    event: 'charge.success',
    data: { reference, metadata: { purpose: 'paymax_gateway', domain: 'voting' } },
  });

const unmarkedCharge = (reference = 'SPT-REG-ABC123') =>
  JSON.stringify({
    event: 'charge.success',
    data: { reference, metadata: { type: 'registration_payment' } },
  });

const pendingIntent = {
  id: 'intent-1',
  applicationId: 'app-9',
  amountKobo: 250_000,
  method: 'PAYSTACK' as const,
  paymentReference: 'SPT-REG-ABC123',
  idempotencyKey: 'idem-1',
  status: 'initiated' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.voteTx = null;
  state.logRows = {};
  state.eventTypeFilters = [];
  state.upserts = [];
  state.logUpdates = [];
  registrationStore.intent = null;
});

describe('gateway handler dedup scoping (AUD-FE-004 residual)', () => {
  it('dedups on a gateway-scoped event_type, never the shared charge.success row', async () => {
    await handleGatewayPaystackWebhook(markedCharge(), 'sig');

    expect(state.eventTypeFilters).toEqual(['gateway:charge.success']);
    expect(state.upserts[0]).toMatchObject({
      provider: 'paystack',
      reference: 'PAY_gw_1',
      event_type: 'gateway:charge.success',
    });
  });

  it('still verifies + fulfils when the VOTE handler already processed the same reference', async () => {
    // The shared-row race: the vote handler's processed `charge.success` row
    // used to make the gateway handler return duplicate and skip verification.
    state.logRows['charge.success'] = { id: 'vote-log', processed: true };
    state.voteTx = { id: 'tx-9', vote_credit_status: 'pending' };

    const res = await handleGatewayPaystackWebhook(markedCharge(), 'sig');

    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(verifyPaystackPayment).toHaveBeenCalledWith('PAY_gw_1');
    expect(bridgedVerifyPaidVote).toHaveBeenCalled();
  });

  it('still dedupes on its OWN scoped row', async () => {
    state.logRows['gateway:charge.success'] = { id: 'gw-log', processed: true };

    const res = await handleGatewayPaystackWebhook(markedCharge(), 'sig');

    expect(res).toMatchObject({ processed: false, duplicate: true });
    expect(verifyPaystackPayment).not.toHaveBeenCalled();
  });
});

describe('gateway handler registration-fee fulfilment (AUD-FE-003 residual)', () => {
  it('fulfils a pending registration intent on a marked gateway charge', async () => {
    registrationStore.intent = pendingIntent;

    const res = await handleGatewayPaystackWebhook(markedCharge('SPT-REG-ABC123'), 'sig');

    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(applyRegistrationPaymentSuccess).toHaveBeenCalledWith('app-9', {
      reference: 'SPT-REG-ABC123',
      method: 'PAYSTACK',
    });
    expect(markRegistrationPaymentIntentStatus).toHaveBeenCalledWith('intent-1', 'completed');
  });

  it('claims an UNMARKED charge.success when a pending registration intent matches the reference', async () => {
    // Server-initiated checkouts never set purpose:'paymax_gateway' — the
    // pending intent row is what makes the event ours.
    registrationStore.intent = pendingIntent;

    const res = await handleGatewayPaystackWebhook(unmarkedCharge(), 'sig');

    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(applyRegistrationPaymentSuccess).toHaveBeenCalled();
    expect(markRegistrationPaymentIntentStatus).toHaveBeenCalledWith('intent-1', 'completed');
  });

  it('does not claim an unmarked charge.success with no pending record (wallet/utility/foreign refs stay untouched)', async () => {
    const res = await handleGatewayPaystackWebhook(unmarkedCharge('PAY_topup_xyz'), 'sig');

    expect(res).toMatchObject({ processed: false, duplicate: false });
    expect(state.upserts).toHaveLength(0);
    expect(verifyPaystackPayment).not.toHaveBeenCalled();
  });

  it('marks the intent failed when Paystack collected less than the fee — terminal, no fulfilment', async () => {
    registrationStore.intent = pendingIntent;
    vi.mocked(verifyPaystackPayment).mockResolvedValueOnce({
      success: true,
      amountKobo: 249_999,
    } as never);

    const res = await handleGatewayPaystackWebhook(markedCharge('SPT-REG-ABC123'), 'sig');

    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(applyRegistrationPaymentSuccess).not.toHaveBeenCalled();
    expect(markRegistrationPaymentIntentStatus).toHaveBeenCalledWith(
      'intent-1',
      'failed',
      expect.stringContaining('249999'),
    );
  });

  it('no-ops on an already-completed intent (idempotent replay)', async () => {
    registrationStore.intent = { ...pendingIntent, status: 'completed' };

    const res = await handleGatewayPaystackWebhook(markedCharge('SPT-REG-ABC123'), 'sig');

    expect(res).toMatchObject({ processed: true, duplicate: false });
    expect(applyRegistrationPaymentSuccess).not.toHaveBeenCalled();
    expect(markRegistrationPaymentIntentStatus).not.toHaveBeenCalled();
  });

  it('surfaces a fulfilment failure so the dispatcher 500s and Paystack retries', async () => {
    registrationStore.intent = pendingIntent;
    vi.mocked(applyRegistrationPaymentSuccess).mockRejectedValueOnce(new Error('draft update failed'));

    const res = await handleGatewayPaystackWebhook(markedCharge('SPT-REG-ABC123'), 'sig');

    expect(res).toMatchObject({ processed: false, duplicate: false, error: 'draft update failed' });
    expect(state.logUpdates.at(-1)).toMatchObject({ processed: false });
  });
});

/**
 * POST /api/v1/payments/gateway/reconcile
 *
 * Periodic backstop for gateway fulfilment (AUD-FE-003 residual): scans the
 * pending intent tables (vote_transactions, registration_payment_intents,
 * openmic_vote_paystack_intents) inside a grace/age window, re-verifies each
 * reference with Paystack, and re-drives the shared fulfilment the webhook
 * runs. Closes the case where a webhook never arrived at all — no
 * payment_webhook_logs row to redrive — and where the client never came back.
 *
 * Authentication: x-cron-secret header must equal GATEWAY_RECONCILE_SECRET —
 * same shared-secret pattern as /api/v1/referrals/outbox/process. 401 when the
 * env var is unset, so the endpoint is off unless an operator wires a cron.
 *
 * Body: { limit?: number (≤100), graceSeconds?: number, maxAgeHours?: number }
 * Returns: { success, scanned, verified, fulfilled, failed }
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { sweepGatewayIntents } from '@/src/server/payments/gateway-reconcile';

export async function POST(request: Request) {
  try {
    const secret = (request.headers.get('x-cron-secret') ?? '').trim();
    const expected = process.env.GATEWAY_RECONCILE_SECRET ?? '';
    if (!expected || secret !== expected) {
      throw new ApiError('Unauthorized — x-cron-secret required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
      graceSeconds?: unknown;
      maxAgeHours?: unknown;
    };
    const limit = Math.min(Math.max(Number(body.limit ?? 25) || 25, 1), 100);
    const graceMs = Math.min(Math.max(Number(body.graceSeconds ?? 120) || 120, 0), 3600) * 1000;
    const maxAgeMs = Math.min(Math.max(Number(body.maxAgeHours ?? 24) || 24, 1), 168) * 3_600_000;

    const result = await sweepGatewayIntents({ limit, graceMs, maxAgeMs });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

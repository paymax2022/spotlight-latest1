/**
 * POST /api/v1/referrals/outbox/process
 *
 * Drains pending `referral.triggered` events from bridge_outbox and processes
 * each one — resolving the share code, preventing self-referral, and crediting
 * the referrer ₦500 via the ledger (idempotent).
 *
 * Authentication: REFERRAL_OUTBOX_SECRET header (server-to-server call from
 * a cron job or Supabase Edge Function). Not a user-facing endpoint.
 *
 * Returns: { processed, skipped, failed }
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { processReferralOutbox } from '@/src/server/referrals/service';

export async function POST(request: Request) {
  try {
    requireFeature('referrals');

    // Simple shared-secret auth for cron/worker calls
    const secret = (request.headers.get('x-outbox-secret') ?? '').trim();
    const expected = process.env.REFERRAL_OUTBOX_SECRET ?? '';
    if (!expected || secret !== expected) {
      throw new ApiError('Unauthorized — x-outbox-secret required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
    const limit = Math.min(Number(body.limit ?? 50), 200);

    const result = await processReferralOutbox(limit);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

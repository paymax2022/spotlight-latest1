/**
 * POST /api/v1/admin/adjustments
 *
 * Initiate a manual wallet credit or debit (maker role).
 * Adjustments < ₦100,000 execute immediately.
 * Adjustments ≥ ₦100,000 are queued as pending_approval for a checker.
 *
 * Requires: Idempotency-Key header, finance:adjust:initiate permission.
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { initiateAdjustment, listAdjustments } from '@/src/server/admin/fintech/service';

export async function POST(request: Request) {
  try {
    requireFeature('fintechAdmin');

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
    if (!idempotencyKey) throw new ApiError('Idempotency-Key header is required', 400);

    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as {
      target_user_id?: unknown;
      type?: unknown;
      amount_kobo?: unknown;
      reason?: unknown;
    };

    if (!body.target_user_id || typeof body.target_user_id !== 'string') {
      throw new ApiError('target_user_id is required', 400);
    }
    if (body.type !== 'CREDIT' && body.type !== 'DEBIT') {
      throw new ApiError("type must be 'CREDIT' or 'DEBIT'", 400);
    }
    const amountKobo = Number(body.amount_kobo);
    if (!Number.isInteger(amountKobo) || amountKobo < 1) {
      throw new ApiError('amount_kobo must be a positive integer', 400);
    }
    if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length < 10) {
      throw new ApiError('reason must be at least 10 characters', 400);
    }

    const result = await initiateAdjustment({
      initiatorId:   user.id,
      targetUserId:  body.target_user_id,
      type:          body.type,
      amountKobo,
      reason:        body.reason,
      idempotencyKey,
    });

    return NextResponse.json({ success: true, adjustment: result }, {
      status: result.alreadyProcessed ? 200 : 201,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(request: Request) {
  try {
    requireFeature('fintechAdmin');

    await requireRequestUser(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? undefined;
    const limit  = parseInt(searchParams.get('limit')  ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0',  10);

    const adjustments = await listAdjustments({ status, limit, offset });

    return NextResponse.json({ success: true, adjustments });
  } catch (err) {
    return handleApiError(err);
  }
}

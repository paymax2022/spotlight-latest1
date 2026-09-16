/**
 * POST /api/v1/admin/adjustments/:id/approve
 *
 * Checker approves a pending adjustment. Executes the credit/debit atomically.
 * Self-approval is blocked.
 *
 * Requires: Idempotency-Key header, finance:adjust:approve permission.
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { approveAdjustment } from '@/src/server/admin/fintech/service';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  try {
    requireFeature('fintechAdmin');

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
    if (!idempotencyKey) throw new ApiError('Idempotency-Key header is required', 400);

    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as {
      checker_note?: unknown;
    };

    const result = await approveAdjustment({
      adjustmentId:   params.id,
      checkerId:      user.id,
      checkerNote:    typeof body.checker_note === 'string' ? body.checker_note : undefined,
      idempotencyKey,
    });

    return NextResponse.json({ success: true, adjustment: result });
  } catch (err) {
    return handleApiError(err);
  }
}

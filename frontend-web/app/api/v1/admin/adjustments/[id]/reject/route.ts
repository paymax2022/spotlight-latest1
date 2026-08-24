/**
 * POST /api/v1/admin/adjustments/:id/reject
 *
 * Checker rejects a pending adjustment. No ledger mutation; adjustment is closed.
 * Checker note (reason for rejection) is required.
 *
 * Requires: finance:adjust:approve permission.
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { rejectAdjustment } from '@/src/server/admin/fintech/service';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  try {
    requireFeature('fintechAdmin');

    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as {
      checker_note?: unknown;
    };

    if (!body.checker_note || typeof body.checker_note !== 'string' || body.checker_note.trim().length < 5) {
      throw new ApiError('checker_note is required when rejecting (min 5 characters)', 400);
    }

    await rejectAdjustment({
      adjustmentId: params.id,
      checkerId:    user.id,
      checkerNote:  body.checker_note.trim(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH  /api/v1/beneficiaries/:id  — update nickname
 * DELETE /api/v1/beneficiaries/:id  — remove from saved list (is_favorite=false)
 *
 * Requires: FEATURE_BENEFICIARIES_ENABLED, authenticated user
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { saveBeneficiary, removeBeneficiary } from '@/src/server/transfers/beneficiaries';

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  try {
    requireFeature('beneficiaries');
    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as { nickname?: unknown };
    if (typeof body.nickname !== 'string') {
      throw new ApiError('nickname must be a string', 400);
    }

    const beneficiary = await saveBeneficiary(user.id, params.id, body.nickname);
    return NextResponse.json({ success: true, beneficiary });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  try {
    requireFeature('beneficiaries');
    const user = await requireRequestUser(request);
    await removeBeneficiary(user.id, params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

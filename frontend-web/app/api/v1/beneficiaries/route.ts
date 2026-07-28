/**
 * GET  /api/v1/beneficiaries  — list saved beneficiaries (is_favorite=true)
 * POST /api/v1/beneficiaries  — save an existing recipient as a beneficiary
 *
 * Requires: FEATURE_BENEFICIARIES_ENABLED, authenticated user
 */
import { NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/src/lib/api/responses';
import { requireFeature } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { listBeneficiaries, saveBeneficiary } from '@/src/server/transfers/beneficiaries';

export async function GET(request: Request) {
  try {
    requireFeature('beneficiaries');
    const user = await requireRequestUser(request);
    const beneficiaries = await listBeneficiaries(user.id);
    return NextResponse.json({ success: true, beneficiaries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    requireFeature('beneficiaries');
    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => ({}))) as {
      recipient_id?: unknown;
      nickname?: unknown;
    };

    if (!body.recipient_id || typeof body.recipient_id !== 'string') {
      throw new ApiError('recipient_id is required', 400);
    }

    const beneficiary = await saveBeneficiary(
      user.id,
      body.recipient_id,
      typeof body.nickname === 'string' ? body.nickname : undefined,
    );

    return NextResponse.json({ success: true, beneficiary }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { buildAnalytics, isAnalyticsType } from '@/src/server/estate/analytics';

// GET /api/v1/estate/analytics/{type}?from=&to= — chart-ready estate analytics.
// Resident-scoped: the estate is resolved server-side from the auth token; the
// client never passes an estate ID. Estate-admin only (mirrors reports).
export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { type } = await context.params;
    if (!isAnalyticsType(type)) throw new ApiError('Unknown analytics type', 400);

    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can view analytics', 403);

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;

    const result = await buildAnalytics(ctx.estateId, type, from, to);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to build analytics');
  }
}

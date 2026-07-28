import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { getFinanceDashboard } from '@/src/server/estate/finance';

// GET /api/v1/estate/finance — estate finance dashboard (admin only).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can view estate finances', 403);
    const dashboard = await getFinanceDashboard(ctx.estateId);
    return NextResponse.json(dashboard);
  } catch (error) { return handleApiError(error, 'Failed to load finance dashboard'); }
}

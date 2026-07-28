import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { buildReports } from '@/src/server/estate/reports';

// GET /api/v1/estate/reports — computed estate reports (admin only).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can view reports', 403);
    const sections = await buildReports(ctx.estateId);
    return NextResponse.json({ sections });
  } catch (error) { return handleApiError(error, 'Failed to build reports'); }
}

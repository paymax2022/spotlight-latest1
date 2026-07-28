import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/analytics — aggregate stats for the estate admin.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [
      { count: codesThisMonth },
      { count: checkInsToday },
      { count: denialsToday },
      checkInsForOpen,
      checkOutsForOpen,
    ] = await Promise.all([
      supabase
        .from('visitor_access_codes')
        .select('id', { count: 'exact', head: true })
        .eq('estate_id', ctx.estateId)
        .gte('created_at', monthStart),
      supabase
        .from('visitor_gate_events')
        .select('id', { count: 'exact', head: true })
        .eq('estate_id', ctx.estateId)
        .eq('action', 'check_in')
        .gte('created_at', todayStart),
      supabase
        .from('visitor_gate_events')
        .select('id', { count: 'exact', head: true })
        .eq('estate_id', ctx.estateId)
        .eq('action', 'deny')
        .gte('created_at', todayStart),
      supabase
        .from('visitor_gate_events')
        .select('access_code_id')
        .eq('estate_id', ctx.estateId)
        .eq('action', 'check_in')
        .gte('created_at', todayStart),
      supabase
        .from('visitor_gate_events')
        .select('access_code_id')
        .eq('estate_id', ctx.estateId)
        .eq('action', 'check_out')
        .gte('created_at', todayStart),
    ]);

    const checkedOutCodes = new Set(
      (checkOutsForOpen.data ?? []).map((r: any) => r.access_code_id),
    );
    const openVisits = (checkInsForOpen.data ?? []).filter(
      (r: any) => !checkedOutCodes.has(r.access_code_id),
    ).length;

    return NextResponse.json({
      codesThisMonth: codesThisMonth ?? 0,
      checkInsToday: checkInsToday ?? 0,
      denialsToday: denialsToday ?? 0,
      openVisits,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load analytics');
  }
}

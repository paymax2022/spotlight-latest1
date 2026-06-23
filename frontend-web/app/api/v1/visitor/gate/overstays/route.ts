import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/gate/overstays — open visits checked in more than 4 hours ago.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const { data: checkIns, error } = await supabase
      .from('visitor_gate_events')
      .select('id, access_code_id, visitor_name, unit_label, created_at')
      .eq('estate_id', guard.estateId)
      .eq('action', 'check_in')
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', fourHoursAgo.toISOString());
    if (error) throw error;

    const { data: checkOuts } = await supabase
      .from('visitor_gate_events')
      .select('access_code_id')
      .eq('estate_id', guard.estateId)
      .eq('action', 'check_out')
      .gte('created_at', todayStart.toISOString());

    const checkedOutCodes = new Set((checkOuts ?? []).map((r: any) => r.access_code_id));
    const overstays = (checkIns ?? []).filter((r: any) => !checkedOutCodes.has(r.access_code_id));

    return NextResponse.json(
      overstays.map((r: any) => ({
        id: r.id,
        visitorName: r.visitor_name,
        unitLabel: r.unit_label,
        checkedInAt: r.created_at,
        accessCodeId: r.access_code_id,
      })),
    );
  } catch (error) {
    return handleApiError(error, 'Failed to load overstays');
  }
}

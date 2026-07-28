import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/gate/vehicles — gate events that have a captured plate.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const { data: rows, error } = await supabase
      .from('visitor_gate_events')
      .select('*')
      .eq('estate_id', guard.estateId)
      .not('captured_plate', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    return NextResponse.json((rows ?? []).map(mapGateEvent));
  } catch (error) {
    return handleApiError(error, 'Failed to load vehicle log');
  }
}

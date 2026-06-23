import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';

// POST /api/v1/visitor/gate/checkout — check out a visitor using the original check-in event id.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json();
    const visitEventId: string = body?.visitEventId;
    const gateId: string = body?.gateId ?? guard.gateId;
    if (!visitEventId) throw new ApiError('visitEventId is required', 400);

    // Load original check-in event for context.
    const { data: checkIn, error: ciErr } = await supabase
      .from('visitor_gate_events')
      .select('*')
      .eq('id', visitEventId)
      .eq('estate_id', guard.estateId)
      .maybeSingle();
    if (ciErr) throw ciErr;
    if (!checkIn) throw new ApiError('Check-in event not found', 404);

    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: guard.estateId,
        access_code_id: (checkIn as any).access_code_id,
        visitor_name: (checkIn as any).visitor_name,
        unit_label: (checkIn as any).unit_label,
        gate_id: gateId,
        guard_id: user.id,
        action: 'check_out',
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to check out visitor');
  }
}

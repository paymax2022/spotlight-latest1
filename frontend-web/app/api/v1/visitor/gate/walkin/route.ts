import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';

// POST /api/v1/visitor/gate/walkin — record a walk-in or emergency visitor (no access code).
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json();
    const visitorName: string = String(body?.visitorName ?? '').trim();
    const unitLabel: string = String(body?.unitLabel ?? '').trim();
    const gateId: string = body?.gateId ?? guard.gateId;
    const action: string = body?.action === 'emergency' ? 'emergency' : 'walk_in';
    const reason: string | null = body?.reason ?? null;

    if (!visitorName) throw new ApiError('visitorName is required', 400);

    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: guard.estateId,
        access_code_id: null,
        visitor_name: visitorName,
        unit_label: unitLabel || null,
        gate_id: gateId,
        guard_id: user.id,
        action,
        reason,
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to record walk-in');
  }
}

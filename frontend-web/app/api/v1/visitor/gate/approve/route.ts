import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/gate/approve — approve a visitor check-in.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json();
    const accessCodeId: string = body?.accessCodeId;
    const visitorName: string = String(body?.visitorName ?? '').trim();
    const unitLabel: string = String(body?.unitLabel ?? '').trim();
    const gateId: string = body?.gateId ?? guard.gateId;
    const plate: string | null = body?.plate ?? null;

    if (!accessCodeId) throw new ApiError('accessCodeId is required', 400);

    // Load code to get estate scoping and issuer.
    const { data: code, error: codeErr } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', accessCodeId)
      .eq('estate_id', guard.estateId)
      .maybeSingle();
    if (codeErr) throw codeErr;
    if (!code) throw new ApiError('Access code not found', 404);

    // Insert check-in event.
    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: guard.estateId,
        access_code_id: accessCodeId,
        visitor_name: visitorName || (code as any).visitor_name,
        unit_label: unitLabel,
        gate_id: gateId,
        guard_id: user.id,
        action: 'check_in',
        captured_plate: plate,
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    // If one_time code, mark as used.
    if ((code as any).code_type === 'one_time') {
      await supabase
        .from('visitor_access_codes')
        .update({ status: 'used' })
        .eq('id', accessCodeId);
    }

    // Notify the issuer.
    await supabase.from('visitor_notifications').insert({
      estate_id: guard.estateId,
      user_id: (code as any).issued_by,
      type: 'checked_in',
      title: 'Visitor Checked In',
      body: `${visitorName || ((code as any).visitor_name ?? 'Your visitor')} has been checked in.`,
      access_code_id: accessCodeId,
      read: false,
    });

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to approve visitor');
  }
}

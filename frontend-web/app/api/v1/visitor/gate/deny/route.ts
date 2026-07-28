import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/gate/deny — deny a visitor entry.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json();
    const accessCodeId: string | null = body?.accessCodeId ?? null;
    const visitorName: string = String(body?.visitorName ?? '').trim();
    const unitLabel: string = String(body?.unitLabel ?? '').trim();
    const gateId: string = body?.gateId ?? guard.gateId;
    const reason: string = String(body?.reason ?? '').trim();

    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: guard.estateId,
        access_code_id: accessCodeId,
        visitor_name: visitorName,
        unit_label: unitLabel,
        gate_id: gateId,
        guard_id: user.id,
        action: 'deny',
        reason: reason || null,
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    // Notify the issuer if we have a code.
    if (accessCodeId) {
      const { data: code } = await supabase
        .from('visitor_access_codes')
        .select(ACCESS_CODE_COLUMNS)
        .eq('id', accessCodeId)
        .maybeSingle();
      if (code) {
        await supabase.from('visitor_notifications').insert({
          estate_id: guard.estateId,
          user_id: (code as any).issued_by,
          type: 'denied',
          title: 'Visitor Denied Entry',
          body: `${visitorName || ((code as any).visitor_name ?? 'Your visitor')} was denied entry${reason ? `: ${reason}` : '.'}`,
          access_code_id: accessCodeId,
          read: false,
        });
      }
    }

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to deny visitor');
  }
}

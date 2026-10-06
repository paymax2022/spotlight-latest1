import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS } from '@/src/server/visitor/visitor.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Record a visitor arrival. Guard action (the resident flow never calls this —
// see app/guard/confirm/[code].tsx): requires an active gate session and the
// code must belong to the guard's estate. Cross-estate and unknown ids both
// 404 so the endpoint can't be used to enumerate or forge events on other
// estates' codes (previously any authenticated user could write gate events).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid access code ID', 400);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const gateId: string | null = body?.gateId ?? null;

    const { data: code, error: codeErr } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', id)
      .eq('estate_id', guard.estateId)
      .maybeSingle();
    if (codeErr) throw codeErr;
    if (!code) throw new ApiError('Access code not found', 404);

    const { data: evt, error: evtErr } = await supabase
      .from('visitor_gate_events')
      .insert({
        estate_id: (code as any).estate_id,
        access_code_id: id,
        visitor_name: (code as any).visitor_name,
        gate_id: gateId,
        guard_id: user.id,
        action: 'arrival',
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    await supabase.from('visitor_notifications').insert({
      estate_id: (code as any).estate_id,
      user_id: (code as any).issued_by,
      type: 'arrival',
      title: 'Visitor Arrived',
      body: `${(code as any).visitor_name ?? 'Your visitor'} has arrived at the gate.`,
      access_code_id: id,
      read: false,
    });

    const { data: rows } = await supabase
      .from('visitor_gate_events')
      .select('*')
      .eq('access_code_id', id)
      .order('created_at', { ascending: false });

    return NextResponse.json({ codeId: id, events: (rows ?? [evt]).map(mapGateEvent) });
  } catch (error) {
    return handleApiError(error, 'Failed to record arrival');
  }
}

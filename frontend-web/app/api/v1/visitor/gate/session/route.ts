import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSession } from '@/src/server/visitor/gate.service';
import { assertEstateWritable } from '@/src/server/estate/resident';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The guard's active gate session.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('gate_sessions')
      .select('*')
      .eq('guard_id', user.id)
      .is('shift_end', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError('No active gate session', 404);

    return NextResponse.json(mapSession(data));
  } catch (error) {
    return handleApiError(error, 'Failed to load gate session');
  }
}

// Start a guard shift: create the gate_sessions row every guard-gated endpoint
// resolves through getGuardContext. Without this route nothing could ever write
// the row — the whole guard surface 403'd "No active gate session".
// Body: { estateId, gateId, gateLabel? }. The caller must be an active member of
// the estate and the gate must be an active estate_gates row in that estate.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const estateId = String(body?.estateId ?? '').trim();
    const gateId = String(body?.gateId ?? '').trim();
    if (!UUID_RE.test(estateId)) throw new ApiError('estateId is required', 400);
    if (!gateId) throw new ApiError('gateId is required', 400);

    const { data: member, error: memErr } = await supabase
      .from('estate_residents')
      .select('id')
      .eq('estate_id', estateId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .is('banned_at', null)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) throw new ApiError('Not a member of this estate', 403);
    // A suspended estate opens no new shifts (mirrors Go /:id/guard/checkin).
    await assertEstateWritable(supabase, estateId);

    const { data: gate, error: gateErr } = await supabase
      .from('estate_gates')
      .select('id, name')
      .eq('id', gateId)
      .eq('estate_id', estateId)
      .eq('active', true)
      .maybeSingle();
    if (gateErr) throw gateErr;
    if (!gate) throw new ApiError('Gate not found in this estate', 404);

    // One open session per guard: close any stale shift so the new sign-in is
    // unambiguous for getGuardContext.
    await supabase
      .from('gate_sessions')
      .update({ shift_end: new Date().toISOString() })
      .eq('guard_id', user.id)
      .is('shift_end', null);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const { data: session, error } = await supabase
      .from('gate_sessions')
      .insert({
        estate_id: estateId,
        gate_id: gateId,
        gate_label: String(body?.gateLabel ?? (gate as any).name ?? ''),
        guard_id: user.id,
        guard_name: (profile as any)?.full_name ?? '',
      })
      .select('*')
      .single();
    if (error) throw error;

    return NextResponse.json(mapSession(session), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to start gate session');
  }
}

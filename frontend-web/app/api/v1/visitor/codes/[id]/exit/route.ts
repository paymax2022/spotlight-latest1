import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapGateEvent } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/codes/{id}/exit — record a visitor check-out.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

    const body = await request.json();
    const gateId: string | null = body?.gateId ?? null;

    const { data: code, error: codeErr } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', id)
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
        action: 'check_out',
        sync_status: 'synced',
      })
      .select('*')
      .single();
    if (evtErr) throw evtErr;

    // Notify issuer.
    await supabase.from('visitor_notifications').insert({
      estate_id: (code as any).estate_id,
      user_id: (code as any).issued_by,
      type: 'checked_out',
      title: 'Visitor Checked Out',
      body: `${(code as any).visitor_name ?? 'Your visitor'} has left the estate.`,
      access_code_id: id,
      read: false,
    });

    return NextResponse.json(mapGateEvent(evt));
  } catch (error) {
    return handleApiError(error, 'Failed to record exit');
  }
}

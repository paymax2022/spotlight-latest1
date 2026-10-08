import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext, mapGateEvent } from '@/src/server/visitor/gate.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gate events for this code.
// Authorization mirrors GET /codes/[id] plus the guard flow: the code issuer,
// or a guard with an active gate session in the code's estate. Everyone else
// gets the same 404 so the route can't be used to enumerate other residents'
// codes or read their visitors' movements (was previously unscoped — IDOR).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid access code ID', 400);
    const supabase = createAdminClient();

    const { data: code, error: codeErr } = await supabase
      .from('visitor_access_codes')
      .select('id, estate_id, issued_by')
      .eq('id', id)
      .maybeSingle();
    if (codeErr) throw codeErr;

    if (!code || (code as any).issued_by !== user.id) {
      // Not the issuer — only a guard on shift at that estate may read it.
      const guard = await getGuardContext(supabase, user.id);
      if (!code || !guard || guard.estateId !== (code as any).estate_id) {
        throw new ApiError('Access code not found', 404);
      }
    }

    const { data: rows, error } = await supabase
      .from('visitor_gate_events')
      .select('*')
      .eq('access_code_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ codeId: id, events: (rows ?? []).map(mapGateEvent) });
  } catch (error) {
    return handleApiError(error, 'Failed to load attendance');
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(['arrival', 'check_in', 'check_out', 'deny', 'walk_in', 'emergency']);

// Reconcile offline gate events.
// Body (optional): { events: [{ id, accessCodeId?, visitorName, unitLabel?,
//   gateId?, action, reason?, plate?, capturedAt? }] }
// Each uploaded event must carry a stable client-generated UUID; the insert
// dedups on the primary key so a replayed sync payload cannot double-count a
// visit (EST-UAT-0109). Events keep their capturedAt as created_at — the
// original gate timestamp survives the outage window (EST-UAT-0108).
// With no body the route retains its old behaviour: flip the guard's own
// pending rows to synced.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const body = await request.json().catch(() => null);
    const events: any[] = Array.isArray(body?.events) ? body.events : [];
    if (events.length > 200) throw new ApiError('Too many events in one sync (max 200)', 400);

    let uploaded = 0;
    if (events.length > 0) {
      const rows = events.map((e) => {
        const id = String(e?.id ?? '').trim();
        if (!UUID_RE.test(id)) throw new ApiError('Each event needs a UUID id for dedup', 400);
        const action = String(e?.action ?? '');
        if (!ALLOWED_ACTIONS.has(action)) throw new ApiError(`Invalid event action: ${action}`, 400);
        const visitorName = String(e?.visitorName ?? '').trim();
        if (!visitorName) throw new ApiError('visitorName is required on each event', 400);
        const capturedAt = e?.capturedAt ? new Date(e.capturedAt) : null;
        return {
          id,
          estate_id: guard.estateId,
          access_code_id: e?.accessCodeId && UUID_RE.test(String(e.accessCodeId)) ? e.accessCodeId : null,
          visitor_name: visitorName,
          unit_label: String(e?.unitLabel ?? ''),
          gate_id: e?.gateId ?? guard.gateId,
          guard_id: user.id,
          action,
          reason: e?.reason ?? null,
          captured_plate: e?.plate ?? null,
          sync_status: 'synced',
          ...(capturedAt && !Number.isNaN(capturedAt.getTime()) ? { created_at: capturedAt.toISOString() } : {}),
        };
      });
      // ignoreDuplicates => ON CONFLICT (id) DO NOTHING: replays are no-ops.
      const { data: inserted, error } = await supabase
        .from('visitor_gate_events')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      uploaded = (inserted ?? []).length;
    }

    const { data: rows, error } = await supabase
      .from('visitor_gate_events')
      .update({ sync_status: 'synced' })
      .eq('estate_id', guard.estateId)
      .eq('sync_status', 'pending')
      .select('id');
    if (error) throw error;

    return NextResponse.json({ synced: (rows ?? []).length + uploaded });
  } catch (error) {
    return handleApiError(error, 'Failed to sync events');
  }
}

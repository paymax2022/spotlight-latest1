import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';

// POST /api/v1/visitor/gate/sync — mark all pending events as synced.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const { data: rows, error } = await supabase
      .from('visitor_gate_events')
      .update({ sync_status: 'synced' })
      .eq('estate_id', guard.estateId)
      .eq('sync_status', 'pending')
      .select('id');
    if (error) throw error;

    return NextResponse.json({ synced: (rows ?? []).length });
  } catch (error) {
    return handleApiError(error, 'Failed to sync events');
  }
}

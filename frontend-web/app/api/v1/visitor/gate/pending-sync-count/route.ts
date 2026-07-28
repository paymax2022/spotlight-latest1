import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/gate/pending-sync-count — events with sync_status='pending'.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const { count, error } = await supabase
      .from('visitor_gate_events')
      .select('id', { count: 'exact', head: true })
      .eq('estate_id', guard.estateId)
      .eq('sync_status', 'pending');
    if (error) throw error;

    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    return handleApiError(error, 'Failed to count pending sync events');
  }
}

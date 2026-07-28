import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';
import { mapGateEvent } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/history — gate events for the resident's estate (newest first).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: rows, error } = await supabase
      .from('visitor_gate_events')
      .select('*')
      .eq('estate_id', ctx.estateId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    return NextResponse.json((rows ?? []).map(mapGateEvent));
  } catch (error) {
    return handleApiError(error, 'Failed to load history');
  }
}

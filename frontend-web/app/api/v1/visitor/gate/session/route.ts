import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSession } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/gate/session — the guard's active gate session.
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

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSession } from '@/src/server/visitor/gate.service';

// POST /api/v1/visitor/gate/handover — end the guard's shift and record handover notes.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const body = await request.json();
    const notes: string | null = body?.notes ?? null;

    const { data: session, error } = await supabase
      .from('gate_sessions')
      .update({
        shift_end: new Date().toISOString(),
        handover_notes: notes,
      })
      .eq('guard_id', user.id)
      .is('shift_end', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!session) throw new ApiError('No active session to hand over', 404);

    return NextResponse.json(mapSession(session));
  } catch (error) {
    return handleApiError(error, 'Failed to record handover');
  }
}

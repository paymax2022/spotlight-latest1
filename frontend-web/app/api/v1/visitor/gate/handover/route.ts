import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSession } from '@/src/server/visitor/gate.service';
import { assertEstateWritable } from '@/src/server/estate/resident';

// End the guard's shift and record handover notes.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const notes: string | null = body?.notes ?? null;

    // Resolve the open session first so the estate lifecycle gate applies
    // before the write (mirrors Go /:id/guard/shift-handover — not exempt).
    const { data: open, error: openErr } = await supabase
      .from('gate_sessions')
      .select('estate_id')
      .eq('guard_id', user.id)
      .is('shift_end', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openErr) throw openErr;
    if (!open) throw new ApiError('No active session to hand over', 404);
    await assertEstateWritable(supabase, (open as any).estate_id);

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

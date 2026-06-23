import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { mapGateEvent } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/codes/{id}/attendance — gate events for this code.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

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

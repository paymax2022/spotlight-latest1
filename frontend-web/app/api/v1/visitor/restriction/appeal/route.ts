import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/restriction/appeal — raise a restriction appeal.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const reason = String(body?.reason ?? '').trim();
    const detail = String(body?.detail ?? '').trim();
    if (!reason) throw new ApiError('reason is required', 400);

    const description = detail ? `${reason}\n\n${detail}` : reason;

    await supabase.from('visitor_incidents').insert({
      estate_id: ctx.estateId,
      kind: 'incident',
      severity: 'low',
      title: 'Restriction Appeal',
      description,
      escalate: false,
      status: 'open',
      created_by: user.id,
    });

    return NextResponse.json({ state: 'restoration_pending' });
  } catch (error) {
    return handleApiError(error, 'Failed to submit appeal');
  }
}

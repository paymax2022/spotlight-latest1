import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';
import { mapRepair } from '../../route';

const COLS = 'id, estate_id, reporter_id, category, description, urgency, status, cost_estimate_kobo, created_at';
const STATUSES = ['reported', 'inspection', 'assigned', 'in_progress', 'completed', 'reopened', 'cancelled'];

// POST /api/v1/estate/repairs/[id]/updates
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const status = STATUSES.includes(body?.status) ? body.status : null;
    if (!status) throw new ApiError('A valid status is required', 400);

    const { data: existing, error: getErr } = await supabase.from('estate_repair_requests').select('id, estate_id').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).estate_id !== ctx.estateId) throw new ApiError('Request not found', 404);

    const { error: insErr } = await supabase.from('repair_updates').insert({
      estate_id: ctx.estateId, request_id: params.id, status, note: body?.note ? String(body.note).trim() : null, by_user: user.id,
    });
    if (insErr) throw insErr;

    const { data: row, error } = await supabase.from('estate_repair_requests').update({ status }).eq('id', params.id).select(COLS).single();
    if (error) throw error;

    const { data: updates } = await supabase.from('repair_updates').select('id, status, note, by_user, created_at').eq('request_id', params.id).order('created_at', { ascending: true });
    const names = await resolveNames(supabase, [(row as any).reporter_id, ...((updates ?? []).map((u: any) => u.by_user))]);
    return NextResponse.json({
      ...mapRepair(row, names),
      updates: (updates ?? []).map((u: any) => ({ id: u.id, status: u.status, note: u.note ?? undefined, byName: u.by_user ? names[u.by_user] ?? undefined : undefined, createdAt: u.created_at })),
    });
  } catch (error) { return handleApiError(error, 'Failed to update repair'); }
}

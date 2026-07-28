import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';
import { mapRepair } from '../route';

const COLS = 'id, estate_id, reporter_id, category, description, urgency, status, cost_estimate_kobo, created_at';

// GET /api/v1/estate/repairs/[id]
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const { data: row, error } = await supabase.from('estate_repair_requests').select(COLS).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Request not found', 404);
    const { data: updates, error: uErr } = await supabase.from('repair_updates').select('id, status, note, by_user, created_at').eq('request_id', params.id).order('created_at', { ascending: true });
    if (uErr) throw uErr;
    const names = await resolveNames(supabase, [(row as any).reporter_id, ...((updates ?? []).map((u: any) => u.by_user))]);
    const mapped = mapRepair(row, names);
    return NextResponse.json({
      ...mapped,
      updates: (updates ?? []).map((u: any) => ({ id: u.id, status: u.status, note: u.note ?? undefined, byName: u.by_user ? names[u.by_user] ?? undefined : undefined, createdAt: u.created_at })),
    });
  } catch (error) { return handleApiError(error, 'Failed to load repair'); }
}

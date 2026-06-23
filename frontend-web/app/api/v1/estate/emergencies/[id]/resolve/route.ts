import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, reporter_id, kind, description, location, status, created_at';

function mapAlert(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, reporterId: row.reporter_id,
    reporterName: row.reporter_id ? names[row.reporter_id] ?? undefined : undefined,
    kind: row.kind, description: row.description ?? undefined, location: row.location ?? undefined,
    status: row.status, createdAt: row.created_at,
  };
}

// POST /api/v1/estate/emergencies/[id]/resolve
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const { data: existing, error: getErr } = await supabase.from('estate_emergency_alerts').select('id, estate_id').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).estate_id !== ctx.estateId) throw new ApiError('Emergency not found', 404);
    const { data: row, error } = await supabase.from('estate_emergency_alerts').update({ status: 'resolved' }).eq('id', params.id).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).reporter_id]);
    return NextResponse.json(mapAlert(row, names));
  } catch (error) { return handleApiError(error, 'Failed to resolve emergency'); }
}

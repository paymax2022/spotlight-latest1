import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, reporter_id, kind, description, location, status, created_at';
const KINDS = ['panic', 'medical', 'fire', 'security', 'noise', 'theft', 'domestic', 'other'];

function mapAlert(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, reporterId: row.reporter_id,
    reporterName: row.reporter_id ? names[row.reporter_id] ?? undefined : undefined,
    kind: row.kind, description: row.description ?? undefined, location: row.location ?? undefined,
    status: row.status, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/emergencies
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_emergency_alerts').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
    if (error) throw error;
    const names = await resolveNames(supabase, (rows ?? []).map((r: any) => r.reporter_id));
    return NextResponse.json((rows ?? []).map((r) => mapAlert(r, names)));
  } catch (error) { return handleApiError(error, 'Failed to list emergencies'); }
}

// POST /api/v1/estate/emergencies
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const kind = KINDS.includes(body?.kind) ? body.kind : null;
    if (!kind) throw new ApiError('A valid emergency kind is required', 400);
    const { data: row, error } = await supabase.from('estate_emergency_alerts').insert({
      estate_id: ctx.estateId, reporter_id: user.id, kind,
      description: body?.description ? String(body.description).trim() : null,
      location: body?.location ? String(body.location).trim() : null, status: 'open',
    }).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).reporter_id]);
    return NextResponse.json(mapAlert(row, names), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to report emergency'); }
}

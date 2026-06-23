import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, reporter_id, category, description, urgency, status, cost_estimate_kobo, created_at';
const CATEGORIES = ['plumbing', 'electrical', 'gate', 'generator', 'elevator', 'water', 'waste', 'road', 'pest', 'facility', 'other'];
const URGENCIES = ['low', 'medium', 'high'];

export function mapRepair(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, reporterId: row.reporter_id,
    reporterName: row.reporter_id ? names[row.reporter_id] ?? undefined : undefined,
    category: row.category, description: row.description, urgency: row.urgency, status: row.status,
    costEstimateKobo: row.cost_estimate_kobo ?? undefined, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/repairs
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_repair_requests').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
    if (error) throw error;
    const names = await resolveNames(supabase, (rows ?? []).map((r: any) => r.reporter_id));
    return NextResponse.json((rows ?? []).map((r) => mapRepair(r, names)));
  } catch (error) { return handleApiError(error, 'Failed to list repairs'); }
}

// POST /api/v1/estate/repairs
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const category = CATEGORIES.includes(body?.category) ? body.category : null;
    if (!category) throw new ApiError('A valid category is required', 400);
    const description = String(body?.description ?? '').trim();
    if (!description) throw new ApiError('Description is required', 400);
    const urgency = URGENCIES.includes(body?.urgency) ? body.urgency : 'medium';
    const { data: row, error } = await supabase.from('estate_repair_requests').insert({
      estate_id: ctx.estateId, reporter_id: user.id, category, description, urgency, status: 'reported',
    }).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).reporter_id]);
    return NextResponse.json(mapRepair(row, names), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to report repair'); }
}

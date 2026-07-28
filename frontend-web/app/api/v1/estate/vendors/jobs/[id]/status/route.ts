import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { mapJob } from '../../route';

const COLS = 'id, estate_id, vendor_id, repair_request_id, status, amount_kobo, created_at';
const STATUSES = ['available', 'accepted', 'rejected', 'en_route', 'in_progress', 'completed', 'paid'];

// POST /api/v1/estate/vendors/jobs/[id]/status
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const status = STATUSES.includes(body?.status) ? body.status : null;
    if (!status) throw new ApiError('A valid status is required', 400);

    const { data: existing, error: getErr } = await supabase.from('vendor_jobs').select('id, estate_id').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).estate_id !== ctx.estateId) throw new ApiError('Job not found', 404);

    const { data: row, error } = await supabase.from('vendor_jobs').update({ status }).eq('id', params.id).select(COLS).single();
    if (error) throw error;
    const { data: vendor } = await supabase.from('estate_vendors').select('name').eq('id', (row as any).vendor_id).maybeSingle();
    return NextResponse.json(mapJob(row, (vendor as any)?.name));
  } catch (error) { return handleApiError(error, 'Failed to update job status'); }
}

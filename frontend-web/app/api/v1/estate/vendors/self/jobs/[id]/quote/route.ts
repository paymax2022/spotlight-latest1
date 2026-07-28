import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, vendor_id, repair_request_id, status, amount_kobo, created_at';

function mapJob(row: any, vendorName?: string) {
  return {
    id: row.id, estateId: row.estate_id, vendorId: row.vendor_id, vendorName,
    repairRequestId: row.repair_request_id ?? undefined, status: row.status,
    amountKobo: row.amount_kobo, createdAt: row.created_at,
  };
}

// POST /api/v1/estate/vendors/self/jobs/{id}/quote — the caller (a vendor)
// submits a quote for one of their jobs (Block 42). Resident-scoped: estate +
// vendor resolved server-side. Body: { amount_kobo } (kobo). Records the quote
// and sets the job amount.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const amountKobo = Number(body?.amount_kobo ?? body?.amountKobo);
    if (!Number.isInteger(amountKobo) || amountKobo < 0) {
      throw new ApiError('A valid amount_kobo (minor units) is required', 400);
    }

    const { data: vendor } = await supabase
      .from('estate_vendors')
      .select('id, name')
      .eq('estate_id', ctx.estateId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!vendor) throw new ApiError('You do not have a vendor profile in this estate', 403);

    const { data: job } = await supabase
      .from('vendor_jobs')
      .select('id, estate_id, vendor_id')
      .eq('id', params.id)
      .maybeSingle();
    if (!job || (job as any).estate_id !== ctx.estateId || (job as any).vendor_id !== (vendor as any).id) {
      throw new ApiError('Job not found', 404);
    }

    const { data: row, error } = await supabase
      .from('vendor_jobs')
      .update({ quote_kobo: amountKobo, amount_kobo: amountKobo })
      .eq('id', params.id)
      .select(COLS)
      .single();
    if (error) throw error;

    return NextResponse.json(mapJob(row, (vendor as any).name));
  } catch (error) {
    return handleApiError(error, 'Failed to submit quote');
  }
}

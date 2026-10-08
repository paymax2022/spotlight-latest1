import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const COLS = 'id, estate_id, vendor_id, repair_request_id, status, amount_kobo, created_at';

function mapJob(row: any, vendorName?: string) {
  return {
    id: row.id, estateId: row.estate_id, vendorId: row.vendor_id, vendorName,
    repairRequestId: row.repair_request_id ?? undefined, status: row.status,
    amountKobo: row.amount_kobo, createdAt: row.created_at,
  };
}

// The caller (a vendor)
// submits a quote for one of their jobs (Block 42). Resident-scoped: estate +
// vendor resolved server-side. Body: { amount_kobo } (kobo). Records the quote
// and sets the job amount.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(params.id)) throw new ApiError('Invalid job ID', 400);

    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
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

    // quote_kobo only — amount_kobo is the payout field the admin sets at
    // AssignJob time. Writing it here lets a vendor overwrite the payout with
    // an arbitrary figure and drain the settlement account on RequestPayout.
    const { data: row, error } = await supabase
      .from('vendor_jobs')
      .update({ quote_kobo: amountKobo })
      .eq('id', params.id)
      .neq('status', 'paid')
      .select(COLS)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new ApiError('Job not found or already paid', 404);

    return NextResponse.json(mapJob(row, (vendor as any).name));
  } catch (error) {
    return handleApiError(error, 'Failed to submit quote');
  }
}

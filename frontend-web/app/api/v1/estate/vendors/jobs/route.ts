import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, vendor_id, repair_request_id, status, amount_kobo, created_at';

export function mapJob(row: any, vendorName?: string) {
  return {
    id: row.id, estateId: row.estate_id, vendorId: row.vendor_id, vendorName,
    repairRequestId: row.repair_request_id ?? undefined, status: row.status,
    amountKobo: row.amount_kobo, createdAt: row.created_at,
  };
}

// EST-UAT-0285: job access is scoped to awarded work: the estate admin sees
// the full board, a vendor sees only its own jobs, other residents see none.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    let query = supabase.from('vendor_jobs').select(COLS).eq('estate_id', ctx.estateId);
    if (ctx.role !== 'estate_admin') {
      const { data: vendor, error: vErr } = await supabase
        .from('estate_vendors').select('id').eq('estate_id', ctx.estateId).eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (vErr) throw vErr;
      if (!vendor) throw new ApiError('Vendor jobs are restricted to the assigned vendor and estate admin', 403);
      query = query.eq('vendor_id', (vendor as any).id);
    }

    const { data: rows, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.vendor_id)));
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: vs } = await supabase.from('estate_vendors').select('id, name').in('id', ids);
      (vs ?? []).forEach((v: any) => { names[v.id] = v.name; });
    }
    return NextResponse.json((rows ?? []).map((r) => mapJob(r, names[r.vendor_id])));
  } catch (error) { return handleApiError(error, 'Failed to list vendor jobs'); }
}

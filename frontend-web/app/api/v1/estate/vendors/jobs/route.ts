import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
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

// GET /api/v1/estate/vendors/jobs
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('vendor_jobs').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
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

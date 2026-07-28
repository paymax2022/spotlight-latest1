import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, name, kind, capacity, fee_kobo';

function mapFacility(row: any) {
  return { id: row.id, estateId: row.estate_id, name: row.name, kind: row.kind, capacity: row.capacity ?? undefined, feeKobo: row.fee_kobo };
}

// GET /api/v1/estate/facilities
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_facilities').select(COLS).eq('estate_id', ctx.estateId).order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json((rows ?? []).map(mapFacility));
  } catch (error) { return handleApiError(error, 'Failed to list facilities'); }
}

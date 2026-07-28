import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, name, category, phone, status, rating';

function mapVendor(row: any) {
  return { id: row.id, estateId: row.estate_id, name: row.name, category: row.category, phone: row.phone ?? undefined, status: row.status, rating: Number(row.rating ?? 0) };
}

// GET /api/v1/estate/vendors
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_vendors').select(COLS).eq('estate_id', ctx.estateId).order('rating', { ascending: false });
    if (error) throw error;
    return NextResponse.json((rows ?? []).map(mapVendor));
  } catch (error) { return handleApiError(error, 'Failed to list vendors'); }
}

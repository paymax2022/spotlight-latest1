import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';
import { mapBooking } from '../../route';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const COLS = 'id, estate_id, facility_id, resident_id, starts_at, ends_at, status, amount_kobo, created_at';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(params.id)) throw new ApiError('Invalid booking ID', 400);

    const { data: existing, error: getErr } = await supabase.from('facility_bookings').select('id, estate_id, resident_id, status').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).estate_id !== ctx.estateId || (existing as any).resident_id !== user.id) throw new ApiError('Booking not found', 404);
    if (['cancelled', 'refunded'].includes((existing as any).status)) throw new ApiError('Booking is already closed', 409);

    const { data: row, error } = await supabase.from('facility_bookings').update({ status: 'cancelled' }).eq('id', params.id).select(COLS).single();
    if (error) throw error;
    const { data: facility } = await supabase.from('estate_facilities').select('name').eq('id', (row as any).facility_id).maybeSingle();
    return NextResponse.json(mapBooking(row, (facility as any)?.name));
  } catch (error) { return handleApiError(error, 'Failed to cancel booking'); }
}

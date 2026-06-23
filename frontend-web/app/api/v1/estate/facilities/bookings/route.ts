import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, facility_id, resident_id, starts_at, ends_at, status, amount_kobo, created_at';

export function mapBooking(row: any, facilityName?: string) {
  return {
    id: row.id, estateId: row.estate_id, facilityId: row.facility_id, facilityName,
    residentId: row.resident_id, startsAt: row.starts_at, endsAt: row.ends_at,
    status: row.status, amountKobo: row.amount_kobo, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/facilities/bookings — current user's bookings
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('facility_bookings').select(COLS).eq('estate_id', ctx.estateId).eq('resident_id', user.id).order('starts_at', { ascending: false });
    if (error) throw error;
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.facility_id)));
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: facs } = await supabase.from('estate_facilities').select('id, name').in('id', ids);
      (facs ?? []).forEach((f: any) => { names[f.id] = f.name; });
    }
    return NextResponse.json((rows ?? []).map((r) => mapBooking(r, names[r.facility_id])));
  } catch (error) { return handleApiError(error, 'Failed to list bookings'); }
}

// POST /api/v1/estate/facilities/bookings — reserve a facility.
// Money note: this records a *reservation* with the fee captured in kobo. No
// balance is moved here; settlement runs through the dues/payments money-path
// (double-entry ledger + audit). Idempotency-Key dedupes accidental re-submits.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const idemKey = request.headers.get('Idempotency-Key');
    if (!idemKey) throw new ApiError('Idempotency-Key header is required', 400);

    const body = await request.json();
    const facilityId = String(body?.facilityId ?? '');
    const startsAt = body?.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body?.endsAt ? new Date(body.endsAt) : null;
    if (!facilityId) throw new ApiError('facilityId is required', 400);
    if (!startsAt || !endsAt || isNaN(+startsAt) || isNaN(+endsAt) || endsAt <= startsAt) throw new ApiError('A valid time window is required', 400);
    if (+startsAt < Date.now()) throw new ApiError('Booking must be in the future', 400);

    const { data: facility, error: fErr } = await supabase.from('estate_facilities').select('id, estate_id, name, fee_kobo').eq('id', facilityId).maybeSingle();
    if (fErr) throw fErr;
    if (!facility || (facility as any).estate_id !== ctx.estateId) throw new ApiError('Facility not found', 404);

    const feeKobo: number = (facility as any).fee_kobo ?? 0;
    const { data: row, error } = await supabase.from('facility_bookings').insert({
      estate_id: ctx.estateId, facility_id: facilityId, resident_id: user.id,
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      status: feeKobo > 0 ? 'pending' : 'confirmed', amount_kobo: feeKobo,
    }).select(COLS).single();
    if (error) throw error;
    return NextResponse.json(mapBooking(row, (facility as any).name), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to create booking'); }
}

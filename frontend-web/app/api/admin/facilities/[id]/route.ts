import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const FACILITY_COLS = 'id, estate_id, name, kind, capacity, fee_kobo';

function mapFacility(row: any) {
  return { id: row.id, estateId: row.estate_id, name: row.name, kind: row.kind, capacity: row.capacity ?? undefined, feeKobo: row.fee_kobo };
}

function mapBooking(row: any) {
  return {
    id: row.id,
    residentId: row.resident_id,
    residentName: row.resident_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    amountKobo: row.amount_kobo,
  };
}

// GET /api/admin/facilities/[id] — Get a specific facility
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('estate_facilities')
      .select(FACILITY_COLS)
      .eq('id', params.id)
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Facility not found' }, { status: 404 });

    return NextResponse.json(mapFacility(data));
  } catch (error) {
    return handleApiError(error, 'Failed to get facility');
  }
}

// PATCH /api/admin/facilities/[id] — Update a facility
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const body = await request.json();

    const { name, kind, capacity, feeKobo } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (kind !== undefined) updates.kind = kind;
    if (capacity !== undefined) updates.capacity = capacity;
    if (feeKobo !== undefined) updates.fee_kobo = feeKobo;

    const { data, error } = await supabase
      .from('estate_facilities')
      .update(updates)
      .eq('id', params.id)
      .select(FACILITY_COLS);

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Facility not found' }, { status: 404 });
    }

    return NextResponse.json(mapFacility(data[0]));
  } catch (error) {
    return handleApiError(error, 'Failed to update facility');
  }
}

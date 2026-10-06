import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
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

// E2E-SEC-054: gated on requireRequestUser only before; requires
// programs:manage now. params is a Promise on this Next version — awaiting it
// also fixes the synchronous-read 500 the route previously threw.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('estate_facilities')
      .select(FACILITY_COLS)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Facility not found' }, { status: 404 });

    return NextResponse.json(mapFacility(data));
  } catch (error) {
    return handleApiError(error, 'Failed to get facility');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const { name, kind, capacity, feeKobo } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (kind !== undefined) updates.kind = kind;
    if (capacity !== undefined) updates.capacity = capacity;
    if (feeKobo !== undefined) updates.fee_kobo = feeKobo;

    const { data, error } = await supabase
      .from('estate_facilities')
      .update(updates)
      .eq('id', id)
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

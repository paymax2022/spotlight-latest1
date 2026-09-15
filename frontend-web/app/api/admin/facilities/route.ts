import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const COLS = 'id, estate_id, name, kind, capacity, fee_kobo';

function mapFacility(row: any) {
  return { id: row.id, estateId: row.estate_id, name: row.name, kind: row.kind, capacity: row.capacity ?? undefined, feeKobo: row.fee_kobo };
}

// GET /api/admin/facilities — List all facilities across all estates
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const { data: rows, error } = await supabase
      .from('estate_facilities')
      .select(COLS)
      .order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json((rows ?? []).map(mapFacility));
  } catch (error) {
    return handleApiError(error, 'Failed to list facilities');
  }
}

// POST /api/admin/facilities — Create a new facility
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const body = await request.json();

    const { name, kind, capacity, feeKobo, estateId } = body;

    if (!name || !kind) {
      return NextResponse.json({ error: 'Name and kind are required' }, { status: 400 });
    }

    // If estateId is not provided, you may want to use a default or require it
    // For now, we'll require it
    if (!estateId) {
      return NextResponse.json({ error: 'Estate ID is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('estate_facilities')
      .insert([
        {
          estate_id: estateId,
          name,
          kind,
          capacity: capacity ?? null,
          fee_kobo: feeKobo ?? 0,
        },
      ])
      .select(COLS);

    if (error) throw error;

    return NextResponse.json(mapFacility(data[0]), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create facility');
  }
}

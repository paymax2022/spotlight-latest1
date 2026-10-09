import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

const COLS = 'id, estate_id, name, kind, capacity, fee_kobo';

function mapFacility(row: any) {
  return { id: row.id, estateId: row.estate_id, name: row.name, kind: row.kind, capacity: row.capacity ?? undefined, feeKobo: row.fee_kobo };
}

// List all facilities across all estates
// E2E-SEC-054: was gated on requireRequestUser only (any signed-in user could
// enumerate every estate's facilities via the RLS-bypassing service client).
// Now requires the same admin permission as /api/admin/programs.
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
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

// E2E-SEC-054: a plain user could create real estate_facilities rows (verified
// 201 live). Now requires programs:manage, resolved from user_roles — not the
// self-assignable user_profiles.role.
export async function POST(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const { name, kind, capacity, feeKobo, estateId } = body;

    if (!name || !kind) {
      return NextResponse.json({ error: 'Name and kind are required' }, { status: 400 });
    }

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

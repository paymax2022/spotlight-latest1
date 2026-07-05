import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, name, category, phone, status, rating';

function mapVendor(row: any) {
  return {
    id: row.id, estateId: row.estate_id, name: row.name, category: row.category,
    phone: row.phone ?? undefined, status: row.status, rating: Number(row.rating ?? 0),
  };
}

// POST /api/v1/estate/vendors/self/onboard — a resident self-registers as a
// vendor in their own estate (Block 42). Resident-scoped: the estate is resolved
// server-side; the vendor row is linked to the caller (estate_vendors.user_id).
// Body: { business_name, category?, phone?, specialties? }.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const businessName = String(body?.business_name ?? body?.businessName ?? '').trim();
    if (!businessName) throw new ApiError('A business name is required', 400);
    const category = body?.category ? String(body.category) : 'general';
    const phone = body?.phone ? String(body.phone) : null;
    const specialties = Array.isArray(body?.specialties) ? body.specialties.map((s: any) => String(s)) : [];

    // One vendor profile per (estate, user) — update in place if it exists.
    const { data: existing } = await supabase
      .from('estate_vendors')
      .select('id')
      .eq('estate_id', ctx.estateId)
      .eq('user_id', user.id)
      .maybeSingle();

    const values = {
      estate_id: ctx.estateId, user_id: user.id, name: businessName,
      business_name: businessName, category, phone, specialties, status: 'pending',
    };

    const { data: row, error } = existing
      ? await supabase.from('estate_vendors').update(values).eq('id', (existing as any).id).select(COLS).single()
      : await supabase.from('estate_vendors').insert(values).select(COLS).single();
    if (error) throw error;

    return NextResponse.json(mapVendor(row), { status: existing ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to onboard vendor');
  }
}

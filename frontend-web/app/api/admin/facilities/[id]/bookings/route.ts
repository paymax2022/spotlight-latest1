import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/facilities/[id]/bookings — Get bookings for a facility
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('facility_bookings')
      .select(`
        id,
        resident_id,
        auth.users!resident_id(email),
        starts_at,
        ends_at,
        status,
        amount_kobo
      `)
      .eq('facility_id', params.id)
      .order('starts_at', { ascending: false });

    if (error) throw error;

    const bookings = (data ?? []).map((b: any) => ({
      id: b.id,
      residentId: b.resident_id,
      residentName: b.auth?.users?.email || 'Unknown',
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      status: b.status,
      amountKobo: b.amount_kobo,
    }));

    return NextResponse.json(bookings);
  } catch (error) {
    return handleApiError(error, 'Failed to get bookings');
  }
}

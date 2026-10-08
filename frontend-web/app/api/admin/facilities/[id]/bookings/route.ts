import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';

// E2E-SEC-054: gated on requireRequestUser only before (any signed-in user
// could read residents' booking PII via the service-role client). Now requires
// programs:manage. params is a Promise on this Next version.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertAdminPermission(request, 'programs:manage');
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
      .eq('facility_id', id)
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

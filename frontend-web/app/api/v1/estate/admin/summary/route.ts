import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

async function countWhere(supabase: any, table: string, build: (q: any) => any): Promise<number> {
  const q = build(supabase.from(table).select('id', { count: 'exact', head: true }));
  const { count, error } = await q;
  // Surface query errors instead of masking them as 0 — a silent 0 would hide
  // items that genuinely need admin attention.
  if (error) throw error;
  return count ?? 0;
}

// GET /api/v1/estate/admin/summary — counts of items needing admin attention.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Admin access required', 403);
    const e = ctx.estateId;

    const [residents, properties, pendingJoinRequests, openEmergencies, openRepairs, pendingInvoices, upcomingMeetings, pendingBookings] = await Promise.all([
      countWhere(supabase, 'estate_residents', (q) => q.eq('estate_id', e)),
      countWhere(supabase, 'estate_properties', (q) => q.eq('estate_id', e)),
      countWhere(supabase, 'estate_join_requests', (q) => q.eq('estate_id', e).eq('status', 'pending')),
      countWhere(supabase, 'estate_emergency_alerts', (q) => q.eq('estate_id', e).neq('status', 'resolved')),
      countWhere(supabase, 'estate_repair_requests', (q) => q.eq('estate_id', e).not('status', 'in', '(completed,cancelled)')),
      countWhere(supabase, 'estate_dues_invoices', (q) => q.eq('estate_id', e).in('status', ['pending', 'overdue'])),
      countWhere(supabase, 'estate_meetings', (q) => q.eq('estate_id', e).gte('starts_at', new Date().toISOString())),
      countWhere(supabase, 'facility_bookings', (q) => q.eq('estate_id', e).eq('status', 'pending')),
    ]);

    return NextResponse.json({
      residents, properties,
      attention: { pendingJoinRequests, openEmergencies, openRepairs, pendingInvoices, pendingBookings },
      upcomingMeetings,
    });
  } catch (error) { return handleApiError(error, 'Failed to load admin summary'); }
}

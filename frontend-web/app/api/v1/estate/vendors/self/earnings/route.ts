import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

// GET /api/v1/estate/vendors/self/earnings — the caller's vendor earnings in
// their estate (Block 42). Resident-scoped: estate + vendor resolved
// server-side (estate_vendors.user_id = caller). Amounts kobo.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: vendor } = await supabase
      .from('estate_vendors')
      .select('id')
      .eq('estate_id', ctx.estateId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!vendor) {
      return NextResponse.json({ paid_jobs: 0, total_earned_kobo: 0, open_jobs: 0 });
    }

    const { data: jobs, error } = await supabase
      .from('vendor_jobs')
      .select('status, amount_kobo')
      .eq('estate_id', ctx.estateId)
      .eq('vendor_id', (vendor as any).id);
    if (error) throw error;

    const rows = jobs ?? [];
    const paid = rows.filter((j: any) => j.status === 'paid');
    return NextResponse.json({
      paid_jobs: paid.length,
      total_earned_kobo: paid.reduce((s: number, j: any) => s + (j.amount_kobo ?? 0), 0),
      open_jobs: rows.filter((j: any) => !['paid', 'rejected'].includes(j.status)).length,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load vendor earnings');
  }
}

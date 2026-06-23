import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, isWithinWindow, mapElection } from '@/src/server/elections/elections.service';

// GET /api/v1/elections/active — the election whose window is open now, or null.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json(null);

    const { data: rows, error } = await supabase
      .from('elections')
      .select('id, estate_id, title, description, starts_at, ends_at, status')
      .eq('estate_id', ctx.estateId)
      .eq('status', 'open')
      .order('starts_at', { ascending: false });
    if (error) throw error;

    const live = (rows ?? []).find((r) => isWithinWindow(r));
    return NextResponse.json(live ? await mapElection(supabase, live) : null);
  } catch (error) {
    return handleApiError(error, 'Failed to load active election');
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/gate/expected — active codes expected at the guard's estate.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('estate_id', guard.estateId)
      .eq('status', 'active')
      .gt('valid_until', now)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const codes = await Promise.all((rows ?? []).map((r) => mapAccessCode(supabase, r)));
    return NextResponse.json(codes);
  } catch (error) {
    return handleApiError(error, 'Failed to load expected visitors');
  }
}

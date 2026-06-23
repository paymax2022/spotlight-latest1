import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/gate/lookup?code= — find an access code by numeric_code or id prefix.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const guard = await getGuardContext(supabase, user.id);
    if (!guard) throw new ApiError('No active gate session', 403);

    const { searchParams } = new URL(request.url);
    const code = (searchParams.get('code') ?? '').trim();
    if (!code) throw new ApiError('code query param required', 400);

    // Try exact numeric_code first, then id prefix.
    let { data: row } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('estate_id', guard.estateId)
      .eq('numeric_code', code)
      .maybeSingle();

    if (!row) {
      const { data: rows } = await supabase
        .from('visitor_access_codes')
        .select(ACCESS_CODE_COLUMNS)
        .eq('estate_id', guard.estateId)
        .ilike('id', `${code}%`)
        .limit(1);
      row = rows?.[0] ?? null;
    }

    if (!row) return NextResponse.json({ found: false, code: null, blacklisted: false });

    // Check blacklist.
    let blacklisted = false;
    const plate = (row as any).vehicle_plate;
    if (plate) {
      const { data: bl } = await supabase
        .from('visitor_blacklist')
        .select('id')
        .eq('estate_id', guard.estateId)
        .eq('match_kind', 'plate')
        .eq('match_value', plate)
        .maybeSingle();
      if (bl) blacklisted = true;
    }

    return NextResponse.json({ found: true, code: await mapAccessCode(supabase, row), blacklisted });
  } catch (error) {
    return handleApiError(error, 'Failed to look up access code');
  }
}

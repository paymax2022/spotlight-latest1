import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getGuardContext } from '@/src/server/visitor/gate.service';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';

// Find an access code by numeric_code or id prefix.
// Rate-limited per guard: the 6-digit code space is small enough to brute
// force (EST-UAT-0095), so repeated probing trips a 429.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const rl = checkRateLimit(`gate-lookup:${user.id}`, 30, 60_000);
    if (!rl.allowed) throw new ApiError('Too many lookups — slow down and retry', 429);
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

    let blacklisted = Boolean((row as any).blacklisted);
    // Watchlist match on every identity the code carries — plate-only matching
    // let a blacklisted visitor through whenever the plate field was blank.
    const watchMatches: Array<{ kind: string; value: string }> = [];
    if ((row as any).vehicle_plate) watchMatches.push({ kind: 'plate', value: (row as any).vehicle_plate });
    if ((row as any).visitor_phone) watchMatches.push({ kind: 'phone', value: (row as any).visitor_phone });
    for (const m of watchMatches) {
      if (blacklisted) break;
      const { data: bl } = await supabase
        .from('visitor_blacklist')
        .select('id')
        .eq('estate_id', guard.estateId)
        .eq('match_kind', m.kind)
        .eq('match_value', m.value)
        .maybeSingle();
      if (bl) blacklisted = true;
    }

    return NextResponse.json({ found: true, code: await mapAccessCode(supabase, row), blacklisted });
  } catch (error) {
    return handleApiError(error, 'Failed to look up access code');
  }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';
import { mapBlacklist } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/blacklist — list all blacklist entries for the estate.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: rows, error } = await supabase
      .from('visitor_blacklist')
      .select('*')
      .eq('estate_id', ctx.estateId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json((rows ?? []).map(mapBlacklist));
  } catch (error) {
    return handleApiError(error, 'Failed to load blacklist');
  }
}

// POST /api/v1/visitor/blacklist — add a blacklist entry.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const matchKind: string = String(body?.matchKind ?? '').trim();
    const matchValue: string = String(body?.matchValue ?? '').trim();
    const name: string | null = body?.name ?? null;
    const reason: string | null = body?.reason ?? null;

    if (!matchKind || !matchValue) throw new ApiError('matchKind and matchValue are required', 400);
    if (!['phone', 'id', 'plate'].includes(matchKind)) throw new ApiError('Invalid matchKind', 400);

    const { data: row, error } = await supabase
      .from('visitor_blacklist')
      .insert({
        estate_id: ctx.estateId,
        match_kind: matchKind,
        match_value: matchValue,
        name,
        reason,
        created_by: user.id,
      })
      .select('*')
      .single();
    if (error) throw error;

    return NextResponse.json(mapBlacklist(row), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to add blacklist entry');
  }
}

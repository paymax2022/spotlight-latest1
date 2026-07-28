import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/search?q= — search visitor codes and residents.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    if (!q) throw new ApiError('q query param required', 400);

    const pattern = `%${q}%`;

    // Search access codes by visitor_name.
    const { data: codeRows } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('estate_id', ctx.estateId)
      .ilike('visitor_name', pattern)
      .order('created_at', { ascending: false })
      .limit(20);

    const codes = await Promise.all((codeRows ?? []).map((r) => mapAccessCode(supabase, r)));

    // Search residents via user_profiles full_name.
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, full_name, avatar_url')
      .ilike('full_name', pattern)
      .limit(20);

    const profileIds = (profiles ?? []).map((p: any) => p.id);
    let residents: any[] = [];
    if (profileIds.length > 0) {
      const { data: residentRows } = await supabase
        .from('estate_residents')
        .select('user_id, unit, role')
        .eq('estate_id', ctx.estateId)
        .in('user_id', profileIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      residents = (residentRows ?? []).map((r: any) => ({
        userId: r.user_id,
        unit: r.unit,
        role: r.role,
        fullName: profileMap.get(r.user_id)?.full_name ?? null,
        avatarUrl: profileMap.get(r.user_id)?.avatar_url ?? null,
      }));
    }

    return NextResponse.json({ codes, residents });
  } catch (error) {
    return handleApiError(error, 'Failed to search');
  }
}

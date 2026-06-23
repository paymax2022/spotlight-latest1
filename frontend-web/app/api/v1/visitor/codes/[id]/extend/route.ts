import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/codes/{id}/extend — extend an active code's validity.
// Body: { validityEnd }. Code value/QR are unchanged.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

    const body = await request.json();
    const validityEnd = body?.validityEnd;
    if (!validityEnd) throw new ApiError('validityEnd is required', 400);

    const { data: existing } = await supabase
      .from('visitor_access_codes')
      .select('id, issued_by, status')
      .eq('id', id)
      .maybeSingle();
    if (!existing || (existing as any).issued_by !== user.id) throw new ApiError('Access code not found', 404);
    if ((existing as any).status !== 'active') throw new ApiError('Only active codes can be extended', 409);

    const { data: row, error } = await supabase
      .from('visitor_access_codes')
      .update({ valid_until: validityEnd })
      .eq('id', id)
      .select(ACCESS_CODE_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json(await mapAccessCode(supabase, row));
  } catch (error) {
    return handleApiError(error, 'Failed to extend access code');
  }
}

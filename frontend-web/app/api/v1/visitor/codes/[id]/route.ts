import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

// GET /api/v1/visitor/codes/{id} — a single access code (owned by the caller).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const { data: row, error } = await supabase
      .from('visitor_access_codes')
      .select(ACCESS_CODE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).issued_by !== user.id) throw new ApiError('Access code not found', 404);
    return NextResponse.json(await mapAccessCode(supabase, row));
  } catch (error) {
    return handleApiError(error, 'Failed to load access code');
  }
}

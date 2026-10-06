import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A single access code (owned by the caller).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    // Non-UUID ids can never match visitor_access_codes.id — reject before the
    // query so a malformed id doesn't surface as a Postgres 22P02 → 500.
    if (!UUID_RE.test(id)) throw new ApiError('Invalid access code ID', 400);
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

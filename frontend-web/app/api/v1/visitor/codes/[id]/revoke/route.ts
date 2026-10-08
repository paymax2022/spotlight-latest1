import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { ACCESS_CODE_COLUMNS, mapAccessCode } from '@/src/server/visitor/visitor.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Revoke a code (invalid at the gate now).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid access code ID', 400);
    const supabase = createAdminClient();

    const { data: existing } = await supabase
      .from('visitor_access_codes')
      .select('id, issued_by')
      .eq('id', id)
      .maybeSingle();
    if (!existing || (existing as any).issued_by !== user.id) throw new ApiError('Access code not found', 404);

    const { data: row, error } = await supabase
      .from('visitor_access_codes')
      .update({ status: 'revoked' })
      .eq('id', id)
      .select(ACCESS_CODE_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json(await mapAccessCode(supabase, row));
  } catch (error) {
    return handleApiError(error, 'Failed to revoke access code');
  }
}

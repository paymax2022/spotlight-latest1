import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Share-stub: the share payload is rendered client-side; this endpoint exists so
// the app can record/confirm the share intent. Still verifies the caller owns
// the code — returning an unconditional 204 would let it act as an
// always-success oracle and diverge from the sibling code routes' 404s.
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

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to share access code');
  }
}

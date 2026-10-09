import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) throw new ApiError('Invalid notification ID', 400);
    const supabase = createAdminClient();

    const { error } = await supabase
      .from('visitor_notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to mark notification as read');
  }
}

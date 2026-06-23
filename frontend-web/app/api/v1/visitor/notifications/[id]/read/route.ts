import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// POST /api/v1/visitor/notifications/{id}/read — mark a single notification as read.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

    const { error } = await supabase
      .from('visitor_notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;

    return NextResponse.json(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, 'Failed to mark notification as read');
  }
}

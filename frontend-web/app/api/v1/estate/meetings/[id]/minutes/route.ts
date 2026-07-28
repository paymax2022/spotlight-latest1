import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/v1/estate/meetings/{id}/minutes — minutes & decisions, or null.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();

    const { data: row, error } = await supabase
      .from('meeting_minutes')
      .select('meeting_id, content, decisions, created_at')
      .eq('meeting_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json(null);

    return NextResponse.json({
      meetingId: (row as any).meeting_id,
      content: (row as any).content ?? '',
      decisions: Array.isArray((row as any).decisions) ? (row as any).decisions : [],
      updatedAt: (row as any).created_at,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load minutes');
  }
}

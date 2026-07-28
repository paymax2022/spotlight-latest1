import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, category, title, body, deep_link, read_at, created_at';

export function mapNotification(row: any) {
  return {
    id: row.id, estateId: row.estate_id, category: row.category, title: row.title,
    body: row.body ?? undefined, deepLink: row.deep_link ?? undefined,
    readAt: row.read_at ?? undefined, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/notifications — current user's notification feed.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_notifications')
      .select(COLS).eq('estate_id', ctx.estateId).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json((rows ?? []).map(mapNotification));
  } catch (error) { return handleApiError(error, 'Failed to list notifications'); }
}

import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, body, kind, created_by, created_at';

// GET /api/v1/estate/announcements — with per-user read state.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_announcements').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (rows ?? []).map((r: any) => r.id);
    const [{ data: reads }, names] = await Promise.all([
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id).in('announcement_id', ids.length ? ids : ['_']),
      resolveNames(supabase, (rows ?? []).map((r: any) => r.created_by)),
    ]);
    const readSet = new Set((reads ?? []).map((r: any) => r.announcement_id));
    return NextResponse.json((rows ?? []).map((r: any) => ({
      id: r.id, estateId: r.estate_id, title: r.title, body: r.body, kind: r.kind,
      createdBy: r.created_by, createdByName: names[r.created_by] ?? 'Estate', createdAt: r.created_at, read: readSet.has(r.id),
    })));
  } catch (error) { return handleApiError(error, 'Failed to list announcements'); }
}

// POST /api/v1/estate/announcements — estate admin posts a notice.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can post announcements', 403);
    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    const text = String(body?.body ?? '').trim();
    if (!title || !text) throw new ApiError('Title and message are required', 400);
    const kind = ['general', 'emergency', 'security', 'payment', 'maintenance', 'meeting', 'election'].includes(body?.kind) ? body.kind : 'general';
    const { data: row, error } = await supabase.from('estate_announcements').insert({ estate_id: ctx.estateId, title, body: text, kind, created_by: user.id }).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [user.id]);
    return NextResponse.json({ id: (row as any).id, estateId: (row as any).estate_id, title: (row as any).title, body: (row as any).body, kind: (row as any).kind, createdBy: user.id, createdByName: names[user.id] ?? 'You', createdAt: (row as any).created_at, read: true }, { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to post announcement'); }
}

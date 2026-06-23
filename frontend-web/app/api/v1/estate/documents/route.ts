import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, category, file_url, uploaded_by, restricted, created_at';

function mapDoc(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, title: row.title, category: row.category, fileUrl: row.file_url,
    uploadedBy: row.uploaded_by, uploaderName: row.uploaded_by ? names[row.uploaded_by] ?? undefined : undefined,
    restricted: row.restricted, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/documents — restricted docs only for estate admins.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    let query = supabase.from('estate_documents').select(COLS).eq('estate_id', ctx.estateId);
    if (ctx.role !== 'estate_admin') query = query.eq('restricted', false);
    const { data: rows, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const names = await resolveNames(supabase, (rows ?? []).map((r: any) => r.uploaded_by));
    return NextResponse.json((rows ?? []).map((r) => mapDoc(r, names)));
  } catch (error) { return handleApiError(error, 'Failed to list documents'); }
}

// POST /api/v1/estate/documents — estate admin records a document.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can add documents', 403);
    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    const fileUrl = String(body?.fileUrl ?? '').trim();
    if (!title) throw new ApiError('Title is required', 400);
    if (!/^https?:\/\//.test(fileUrl)) throw new ApiError('A valid file URL is required', 400);
    const category = String(body?.category ?? 'general').trim() || 'general';
    const { data: row, error } = await supabase.from('estate_documents').insert({
      estate_id: ctx.estateId, title, category, file_url: fileUrl, uploaded_by: user.id, restricted: !!body?.restricted,
    }).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [user.id]);
    return NextResponse.json(mapDoc(row, names), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to add document'); }
}

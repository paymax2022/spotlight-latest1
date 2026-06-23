import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, description, assignee_id, created_by, due_date, priority, status, created_at';

// POST /api/v1/estate/tasks/{id}/status — Body: { status }.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const status = String(body?.status ?? '');
    if (!['todo', 'in_progress', 'done'].includes(status)) throw new ApiError('Invalid status', 400);

    const { data: existing } = await supabase.from('estate_tasks').select('id, estate_id').eq('id', id).maybeSingle();
    if (!existing || (existing as any).estate_id !== ctx.estateId) throw new ApiError('Task not found', 404);

    const { data: row, error } = await supabase.from('estate_tasks').update({ status }).eq('id', id).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).assignee_id]);
    return NextResponse.json({
      id: (row as any).id, estateId: (row as any).estate_id, title: (row as any).title, description: (row as any).description ?? undefined,
      assigneeId: (row as any).assignee_id ?? null, assigneeName: (row as any).assignee_id ? names[(row as any).assignee_id] ?? null : null,
      createdBy: (row as any).created_by, dueDate: (row as any).due_date ?? null, priority: (row as any).priority, status: (row as any).status, createdAt: (row as any).created_at,
    });
  } catch (error) { return handleApiError(error, 'Failed to update task'); }
}

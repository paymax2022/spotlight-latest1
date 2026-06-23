import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, description, assignee_id, created_by, due_date, priority, status, created_at';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const { data: row, error } = await supabase.from('estate_tasks').select(COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Task not found', 404);
    const names = await resolveNames(supabase, [(row as any).assignee_id]);
    return NextResponse.json({
      id: (row as any).id, estateId: (row as any).estate_id, title: (row as any).title, description: (row as any).description ?? undefined,
      assigneeId: (row as any).assignee_id ?? null, assigneeName: (row as any).assignee_id ? names[(row as any).assignee_id] ?? null : null,
      createdBy: (row as any).created_by, dueDate: (row as any).due_date ?? null, priority: (row as any).priority, status: (row as any).status, createdAt: (row as any).created_at,
    });
  } catch (error) { return handleApiError(error, 'Failed to load task'); }
}

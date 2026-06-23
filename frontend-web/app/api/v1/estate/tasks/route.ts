import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';

const COLS = 'id, estate_id, title, description, assignee_id, created_by, due_date, priority, status, created_at';

function mapTask(row: any, names: Record<string, string>) {
  return {
    id: row.id, estateId: row.estate_id, title: row.title, description: row.description ?? undefined,
    assigneeId: row.assignee_id ?? null, assigneeName: row.assignee_id ? names[row.assignee_id] ?? null : null,
    createdBy: row.created_by, dueDate: row.due_date ?? null, priority: row.priority, status: row.status, createdAt: row.created_at,
  };
}

// GET /api/v1/estate/tasks
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);
    const { data: rows, error } = await supabase.from('estate_tasks').select(COLS).eq('estate_id', ctx.estateId).order('created_at', { ascending: false });
    if (error) throw error;
    const names = await resolveNames(supabase, (rows ?? []).map((r: any) => r.assignee_id));
    return NextResponse.json((rows ?? []).map((r) => mapTask(r, names)));
  } catch (error) { return handleApiError(error, 'Failed to list tasks'); }
}

// POST /api/v1/estate/tasks
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    if (!title) throw new ApiError('Task title is required', 400);
    const priority = ['low', 'medium', 'high'].includes(body?.priority) ? body.priority : 'medium';
    const { data: row, error } = await supabase.from('estate_tasks').insert({
      estate_id: ctx.estateId, title, description: body?.description ? String(body.description).trim() : null,
      assignee_id: body?.assigneeId ?? null, created_by: user.id, due_date: body?.dueDate ?? null, priority, status: 'todo',
    }).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).assignee_id]);
    return NextResponse.json(mapTask(row, names), { status: 201 });
  } catch (error) { return handleApiError(error, 'Failed to create task'); }
}

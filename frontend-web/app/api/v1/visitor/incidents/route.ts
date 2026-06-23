import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/visitor/visitor.service';
import { mapIncident } from '@/src/server/visitor/gate.service';

// GET /api/v1/visitor/incidents — list incidents for the estate.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const { data: rows, error } = await supabase
      .from('visitor_incidents')
      .select('*')
      .eq('estate_id', ctx.estateId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json((rows ?? []).map(mapIncident));
  } catch (error) {
    return handleApiError(error, 'Failed to load incidents');
  }
}

// POST /api/v1/visitor/incidents — create an incident report.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const body = await request.json();
    const kind: string = String(body?.kind ?? 'incident');
    const severity: string = String(body?.severity ?? 'low');
    const title: string = String(body?.title ?? '').trim();
    const description: string | null = body?.description ?? null;
    const escalate: boolean = Boolean(body?.escalate ?? false);
    const gateId: string | null = body?.gateId ?? null;

    if (!title) throw new ApiError('title is required', 400);
    if (!['suspicious', 'incident'].includes(kind)) throw new ApiError('Invalid kind', 400);
    if (!['low', 'medium', 'high'].includes(severity)) throw new ApiError('Invalid severity', 400);

    const { data: row, error } = await supabase
      .from('visitor_incidents')
      .insert({
        estate_id: ctx.estateId,
        gate_id: gateId,
        kind,
        severity,
        title,
        description,
        escalate,
        status: escalate ? 'escalated' : 'open',
        created_by: user.id,
      })
      .select('*')
      .single();
    if (error) throw error;

    return NextResponse.json(mapIncident(row), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create incident');
  }
}

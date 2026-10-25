import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, resolveNames } from '@/src/server/estate/resident';
import { mapRepair } from '../route';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const COLS = 'id, estate_id, reporter_id, category, description, urgency, status, cost_estimate_kobo, created_at';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    // Reject malformed ids before the query (Postgres 22P02 → 500 otherwise).
    if (!UUID_RE.test(params.id)) throw new ApiError('Invalid repair request ID', 400);
    const { data: row, error } = await supabase.from('estate_repair_requests').select(COLS).eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!row || (row as any).estate_id !== ctx.estateId) throw new ApiError('Request not found', 404);
    const { data: updates, error: uErr } = await supabase.from('repair_updates').select('id, status, note, by_user, created_at').eq('request_id', params.id).order('created_at', { ascending: true });
    if (uErr) throw uErr;
    const names = await resolveNames(supabase, [(row as any).reporter_id, ...((updates ?? []).map((u: any) => u.by_user))]);
    const mapped = mapRepair(row, names);
    return NextResponse.json({
      ...mapped,
      updates: (updates ?? []).map((u: any) => ({ id: u.id, status: u.status, note: u.note ?? undefined, byName: u.by_user ? names[u.by_user] ?? undefined : undefined, createdAt: u.created_at })),
    });
  } catch (error) { return handleApiError(error, 'Failed to load repair'); }
}

// Reporter sign-off (EST-UAT-0243/-0244): the resident who raised the ticket
// accepts the completed work (stays closed) or rejects it, which reopens the
// ticket for rework. Either way the transition is appended to repair_updates;
// the prior evidence trail is never overwritten.
const ACCEPT_FROM = ['reported', 'inspection', 'assigned', 'in_progress', 'reopened'];
const REOPEN_FROM = ['completed'];

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const resCtx = await getResidentContext(supabase, user.id, { forWrite: true });
    if (!resCtx) throw new ApiError('Not a resident of any estate', 403);
    if (!UUID_RE.test(params.id)) throw new ApiError('Invalid repair request ID', 400);
    const body = await request.json().catch(() => null);
    if (!body) throw new ApiError('Invalid JSON body', 400);
    const action = body?.action;
    if (action !== 'accept' && action !== 'reject') throw new ApiError("action must be 'accept' or 'reject'", 400);
    const note = body?.note ? String(body.note).trim() : null;

    const { data: existing, error: getErr } = await supabase
      .from('estate_repair_requests').select('id, estate_id, reporter_id, status').eq('id', params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!existing || (existing as any).estate_id !== resCtx.estateId) throw new ApiError('Request not found', 404);
    // Only the reporter signs off their own ticket; an admin manages the queue
    // via repair updates, not by impersonating the resident's acceptance.
    if ((existing as any).reporter_id !== user.id) throw new ApiError('Only the reporter can sign off this request', 403);

    const from = (existing as any).status as string;
    const to = action === 'accept' ? 'completed' : 'reopened';
    const allowed = action === 'accept' ? ACCEPT_FROM : REOPEN_FROM;
    if (!allowed.includes(from)) {
      throw new ApiError(`Cannot ${action} a request in status '${from}'`, 409);
    }

    const { error: uErr } = await supabase.from('repair_updates').insert({
      estate_id: resCtx.estateId, request_id: params.id, status: to,
      note: note ?? (action === 'accept' ? 'Resident confirmed resolution' : 'Resident rejected the fix; rework requested'),
      by_user: user.id,
    });
    if (uErr) throw uErr;
    const { data: row, error } = await supabase.from('estate_repair_requests').update({ status: to }).eq('id', params.id).select(COLS).single();
    if (error) throw error;
    const names = await resolveNames(supabase, [(row as any).reporter_id]);
    return NextResponse.json(mapRepair(row, names));
  } catch (error) { return handleApiError(error, 'Failed to sign off repair'); }
}

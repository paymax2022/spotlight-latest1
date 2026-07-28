import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, mapElection } from '@/src/server/elections/elections.service';

// GET /api/v1/elections — elections for the caller's estate (newest first).
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) return NextResponse.json([]);

    const { data: rows, error } = await supabase
      .from('elections')
      .select('id, estate_id, title, description, starts_at, ends_at, status')
      .eq('estate_id', ctx.estateId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const result = await Promise.all((rows ?? []).map((r) => mapElection(supabase, r)));
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, 'Failed to list elections');
  }
}

// POST /api/v1/elections — create/schedule an election (estate admin).
// Single-position schema: candidates from all positions are flattened onto the
// election (see service note). Window drives live/closed; status starts 'open'.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Only an estate admin can create elections', 403);

    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    const startsAt = body?.startsAt;
    const endsAt = body?.endsAt;
    const positions = Array.isArray(body?.positions) ? body.positions : [];
    if (!title) throw new ApiError('Election title is required', 400);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new ApiError('End time must be after the start time', 400);
    }
    const candidateNames: string[] = positions
      .flatMap((p: any) => (Array.isArray(p?.candidateNames) ? p.candidateNames : []))
      .map((n: any) => String(n).trim())
      .filter(Boolean);
    if (candidateNames.length < 2) throw new ApiError('Add at least two candidates', 400);

    const { data: election, error: insErr } = await supabase
      .from('elections')
      .insert({
        estate_id: ctx.estateId,
        title,
        description: body?.description ? String(body.description).trim() : null,
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'open',
        created_by: user.id,
      })
      .select('id, estate_id, title, description, starts_at, ends_at, status')
      .single();
    if (insErr) throw insErr;

    const { error: candErr } = await supabase
      .from('election_candidates')
      .insert(candidateNames.map((name) => ({ election_id: (election as any).id, name })));
    if (candErr) throw candErr;

    return NextResponse.json(await mapElection(supabase, election), { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create election');
  }
}

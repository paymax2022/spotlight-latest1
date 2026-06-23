import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    const supabase = createAdminClient();

    let q = supabase.from('voting_rounds').select('*').order('round_number', { ascending: true });
    if (contestId) q = q.eq('contest_id', contestId);

    const { data, error } = await q;
    if (error) return errorResponse('Failed to load rounds', 500);
    return successResponse({ success: true, rounds: data ?? [] });
  } catch (e) { return handleApiError(e, 'Failed to load rounds'); }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();
    if (!body.contestId || !body.name || !body.slug) return errorResponse('contestId, name, slug required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase.from('voting_rounds').insert({
      contest_id: body.contestId,
      name: body.name,
      slug: body.slug,
      round_number: body.roundNumber ?? 1,
      round_type: body.roundType ?? 'standard',
      voting_type: body.votingType ?? 'hybrid',
      free_votes_per_day: body.freeVotesPerDay ?? null,
      carry_forward_votes: body.carryForwardVotes ?? false,
      reset_votes: body.resetVotes ?? false,
      vote_weight: body.voteWeight ?? 1.0,
      judge_score_weight: body.judgeScoreWeight ?? 0.0,
      public_vote_weight: body.publicVoteWeight ?? 1.0,
      elimination_count: body.eliminationCount ?? null,
      qualification_count: body.qualificationCount ?? null,
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      status: 'upcoming',
    }).select('*').single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({ actorId: identity.actorId, actorRole: identity.role, action: 'voting_round_created',
      entityType: 'voting_round', entityId: (data as any).id, contestId: body.contestId, newValue: body });

    return successResponse({ success: true, round: data }, 201);
  } catch (e) { return handleApiError(e, 'Failed to create round'); }
}

export async function PATCH(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();
    if (!body.id) return errorResponse('id required', 400);

    const supabase = createAdminClient();
    const allowed = ['name','slug','round_number','round_type','voting_type','free_votes_per_day',
      'carry_forward_votes','reset_votes','vote_weight','judge_score_weight','public_vote_weight',
      'elimination_count','qualification_count','starts_at','ends_at','status'];

    const updates: Record<string, unknown> = {};
    const camelToSnake = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camel] !== undefined) updates[key] = body[camel] || null;
      else if (body[key] !== undefined) updates[key] = body[key] || null;
    }

    const { data, error } = await supabase.from('voting_rounds').update(updates).eq('id', body.id).select('*').single();
    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({ actorId: identity.actorId, actorRole: identity.role, action: 'voting_round_updated',
      entityType: 'voting_round', entityId: body.id, newValue: updates });

    return successResponse({ success: true, round: data });
  } catch (e) { return handleApiError(e, 'Failed to update round'); }
}

import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

// Per-phase visibility overrides for a contest. A phase can hide the
// leaderboard / vote count / rank independently of the contest-level flags.
// The active phase is set via voting_settings.active_phase_key (settings route).

// GET /api/admin/voting/phases?contestId=...
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    if (!contestId) return errorResponse('contestId is required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('voting_phases')
      .select('*')
      .eq('contest_id', contestId)
      .order('sort_order', { ascending: true });

    if (error) return errorResponse('Failed to load phases', 500);
    return successResponse({ success: true, phases: data ?? [] });
  } catch (error) {
    return handleApiError(error, 'Failed to load voting phases');
  }
}

// POST /api/admin/voting/phases — create/update a phase (upsert by contest+key)
export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();
    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.phaseKey) return errorResponse('phaseKey is required', 400);
    if (!body.phaseLabel) return errorResponse('phaseLabel is required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('voting_phases')
      .upsert(
        {
          contest_id: body.contestId,
          phase_key: body.phaseKey,
          phase_label: body.phaseLabel,
          show_public_vote_count: body.showPublicVoteCount ?? true,
          show_public_leaderboard: body.showPublicLeaderboard ?? true,
          show_public_rank: body.showPublicRank ?? true,
          sort_order: body.sortOrder ?? 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'contest_id,phase_key' },
      )
      .select('*')
      .single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'voting_phase_upserted',
      entityType: 'voting_phase',
      entityId: (data as { id: string }).id,
      contestId: body.contestId,
      newValue: body,
    });

    return successResponse({ success: true, phase: data });
  } catch (error) {
    return handleApiError(error, 'Failed to save voting phase');
  }
}

// DELETE /api/admin/voting/phases?contestId=...&phaseKey=...
export async function DELETE(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');
    const phaseKey = searchParams.get('phaseKey');
    if (!contestId || !phaseKey) return errorResponse('contestId and phaseKey are required', 400);

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('voting_phases')
      .delete()
      .eq('contest_id', contestId)
      .eq('phase_key', phaseKey);

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'voting_phase_deleted',
      entityType: 'voting_phase',
      entityId: `${contestId}:${phaseKey}`,
      contestId,
      newValue: { phaseKey },
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete voting phase');
  }
}

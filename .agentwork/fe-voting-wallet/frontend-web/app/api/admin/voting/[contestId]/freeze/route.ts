import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import { getLeaderboard } from '@/src/server/voting/totals.service';

export async function POST(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;
    const body = (await request.json()) as { action: 'freeze' | 'unfreeze'; snapshotLabel?: string };

    if (!body.action) return errorResponse('action is required', 400);

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    if (body.action === 'freeze') {
      // Take a live snapshot first
      const leaderboard = await getLeaderboard(contestId, undefined, 1000);
      await supabase.from('leaderboard_snapshots').insert({
        contest_id: contestId,
        snapshot_at: now,
        is_final: false,
        snapshot_data: leaderboard as never,
      });

      await supabase
        .from('voting_settings')
        .update({ leaderboard_freeze_enabled: true, leaderboard_freeze_at: now })
        .eq('contest_id', contestId);
    } else {
      await supabase
        .from('voting_settings')
        .update({ leaderboard_freeze_enabled: false, leaderboard_freeze_at: null })
        .eq('contest_id', contestId);
    }

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: body.action === 'freeze' ? 'leaderboard_frozen' : 'leaderboard_unfrozen',
      entityType: 'voting_settings',
      entityId: contestId,
      contestId,
      newValue: { action: body.action, at: now },
    });

    return successResponse({ success: true, action: body.action, at: now });
  } catch (error) {
    return handleApiError(error, 'Failed to update leaderboard freeze');
  }
}

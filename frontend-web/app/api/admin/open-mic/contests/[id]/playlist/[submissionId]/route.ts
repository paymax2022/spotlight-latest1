import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { updateFinalePlaybackItem } from '@/src/server/openmic/persistence';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function PATCH(
  request: Request,
  context: { params: { id: string; submissionId: string } }
) {
  try {
    const identity = assertOpenMicScoreAdmin(request);
    const body = (await request.json()) as {
      played?: boolean;
      djCueNote?: string;
      judgeScore?: number;
      audienceReactionScore?: number;
    };
    const item = await updateFinalePlaybackItem(context.params.id, context.params.submissionId, {
      played: body.played,
      djCueNote: body.djCueNote,
      judgeScore: body.judgeScore,
      audienceReactionScore: body.audienceReactionScore,
    });
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_playback_item_update',
      module: 'open_mic',
      entityType: 'finale_playlist_item',
      entityId: `${context.params.id}:${context.params.submissionId}`,
      reason: 'Updated finale playback metadata',
      newValue: {
        played: body.played,
        judgeScore: body.judgeScore,
        audienceReactionScore: body.audienceReactionScore,
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, item });
  } catch (error) {
    return handleApiError(error, 'Failed to update finale playback item');
  }
}

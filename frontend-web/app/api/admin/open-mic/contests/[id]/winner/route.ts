import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { announceWinner } from '@/src/server/openmic/persistence';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const identity = assertOpenMicScoreAdmin(request);
    const body = (await request.json()) as { submissionId?: string };
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    const winner = await announceWinner(context.params.id, body.submissionId, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_announce_winner',
      module: 'open_mic',
      entityType: 'contest',
      entityId: context.params.id,
      reason: 'Winner announced',
      newValue: { submissionId: body.submissionId, winner: winner?.id || null },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, winner });
  } catch (error) {
    return handleApiError(error, 'Failed to announce winner');
  }
}

import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { generateFinalists, getLeaderboard } from '@/src/server/openmic/persistence';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicScoreAdmin(request);
    const leaderboard = await getLeaderboard(params.id);
    const finalists = leaderboard.filter((entry) => entry.isFinalist).slice(0, 200);
    return successResponse({ success: true, finalists, leaderboard: leaderboard.slice(0, 50) });
  } catch (error) {
    return handleApiError(error, 'Failed to load finalists');
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const identity = await assertOpenMicScoreAdmin(request);
    const finalists = await generateFinalists(params.id);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_generate_finalists',
      module: 'open_mic',
      entityType: 'contest',
      entityId: params.id,
      reason: 'Generated finalists list',
      newValue: { finalistCount: finalists.length },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, finalists });
  } catch (error) {
    return handleApiError(error, 'Failed to generate finalists');
  }
}

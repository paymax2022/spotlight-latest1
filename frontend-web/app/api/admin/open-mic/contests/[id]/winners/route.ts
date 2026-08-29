import { handleApiError, successResponse, errorResponse } from '@/src/lib/api/responses';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { announceWinner, listSubmissions } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicScoreAdmin(request);
    const submissions = await listSubmissions({ contestId: params.id });
    const winners = submissions.filter((row) => row.isWinner || row.status === 'winner');
    return successResponse({ success: true, winners });
  } catch (error) {
    return handleApiError(error, 'Failed to load winners');
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const identity = await assertOpenMicScoreAdmin(request);
    const body = (await request.json()) as { submissionId?: string };
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    const winner = await announceWinner(params.id, body.submissionId, identity.actorId);
    return successResponse({ success: true, winner });
  } catch (error) {
    return handleApiError(error, 'Failed to announce winner');
  }
}

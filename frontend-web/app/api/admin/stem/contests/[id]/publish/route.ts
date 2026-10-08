import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { publishContest } from '@/src/server/stem/persistence';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { actorId } = await assertStemAdmin(request);
    const { id } = await context.params;
    const contest = await publishContest(id, actorId);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to publish STEM contest');
  }
}

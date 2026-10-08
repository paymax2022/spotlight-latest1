import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { addContestCategory } from '@/src/server/stem/persistence';
import type { StemContestCategory } from '@/src/features/stem/types';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await assertStemAdmin(request);
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as Partial<StemContestCategory>;
    if (!body) return errorResponse('Invalid JSON body', 400);
    const category = await addContestCategory(id, body);
    return successResponse({ success: true, category }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create STEM contest category');
  }
}

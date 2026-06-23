import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { addContestCategory } from '@/src/server/stem/persistence';
import type { StemContestCategory } from '@/src/features/stem/types';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    await assertStemAdmin(request);
    const body = (await request.json()) as Partial<StemContestCategory>;
    const category = await addContestCategory(context.params.id, body);
    return successResponse({ success: true, category }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create STEM contest category');
  }
}

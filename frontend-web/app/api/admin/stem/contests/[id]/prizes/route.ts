import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { addPrizeCategory } from '@/src/server/stem/persistence';
import type { StemPrizeCategory } from '@/src/features/stem/types';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    assertStemAdmin(request);
    const body = (await request.json()) as Partial<StemPrizeCategory>;
    const prizeCategory = await addPrizeCategory(context.params.id, body);
    return successResponse({ success: true, prizeCategory }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create STEM prize category');
  }
}

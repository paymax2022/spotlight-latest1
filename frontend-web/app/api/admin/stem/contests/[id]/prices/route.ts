import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { addPriceCategory } from '@/src/server/stem/persistence';
import type { StemPriceCategory } from '@/src/features/stem/types';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    await assertStemAdmin(request);
    const body = (await request.json().catch(() => null)) as Partial<StemPriceCategory>;
    if (!body) return errorResponse('Invalid JSON body', 400);
    const priceCategory = await addPriceCategory(context.params.id, body);
    return successResponse({ success: true, priceCategory }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create STEM price category');
  }
}

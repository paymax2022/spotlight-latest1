import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import { upsertBeat } from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    await assertOpenMicAdmin(request);
    const body = await request.json();
    const beat = await upsertBeat(context.params.id, body);
    return successResponse({ success: true, beat }, 201);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && error instanceof Error) {
      return handleApiError(error, `Failed to upload/update beat: ${error.message}`);
    }
    return handleApiError(error, 'Failed to upload/update beat');
  }
}

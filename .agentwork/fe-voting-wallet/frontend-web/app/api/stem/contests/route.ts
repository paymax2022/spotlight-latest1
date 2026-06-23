import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { listContests } from '@/src/server/stem/persistence';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const contests = await listContests({ status });
    return successResponse({ success: true, contests });
  } catch (error) {
    return handleApiError(error, 'Failed to list STEM contests');
  }
}

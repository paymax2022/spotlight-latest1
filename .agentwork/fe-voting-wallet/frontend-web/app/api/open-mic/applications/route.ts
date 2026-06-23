import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { listApplications } from '@/src/server/openmic/persistence';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const applications = await listApplications({ contestId, userId: user.id });
    return successResponse({ success: true, applications });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load your applications');
  }
}
